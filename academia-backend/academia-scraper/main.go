package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

const (
	defaultAttendanceURL = "https://academia.srmist.edu.in/srm_university/academia-academic-services/page/My_Attendance"
	defaultRefererURL    = "https://academia.srmist.edu.in/#Page:My_Attendance"
	defaultUserAgent     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

type InputCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
}

type AttendanceRequest struct {
	AttendanceURL string        `json:"attendanceUrl"`
	RefererURL    string        `json:"refererUrl"`
	UserAgent     string        `json:"userAgent"`
	Cookies       []InputCookie `json:"cookies"`
}

type AttendanceRecord struct {
	CourseCode     string `json:"courseCode"`
	CourseTitle    string `json:"courseTitle"`
	Category       string `json:"category"`
	FacultyName    string `json:"facultyName"`
	Slot           string `json:"slot"`
	RoomNo         string `json:"roomNo"`
	HoursConducted string `json:"hoursConducted"`
	HoursAbsent    string `json:"hoursAbsent"`
	AttendancePct  string `json:"attendancePct"`
}

type DebugInfo struct {
	PayloadFound        bool     `json:"payloadFound"`
	PayloadLength       int      `json:"payloadLength"`
	DecodedLength       int      `json:"decodedLength"`
	DecodedHasCourse    bool     `json:"decodedHasCourseCode"`
	DecodedHasAttn      bool     `json:"decodedHasAttnPct"`
	DecodedHasHours     bool     `json:"decodedHasHoursConducted"`
	MatchedHeaders      []string `json:"matchedHeaders"`
	MatchedRowCount     int      `json:"matchedRowCount"`
	ResponseContentType string   `json:"responseContentType"`
}

type AttendanceResponse struct {
	Success    bool               `json:"success"`
	StatusCode int                `json:"statusCode"`
	URL        string             `json:"url"`
	Debug      DebugInfo          `json:"debug"`
	Attendance []AttendanceRecord `json:"attendance,omitempty"`
	Error      string             `json:"error,omitempty"`
}

func main() {
	var req AttendanceRequest
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		writeJSON(AttendanceResponse{
			Success: false,
			Error:   "could not decode stdin JSON: " + err.Error(),
		})
		os.Exit(1)
	}

	if req.AttendanceURL == "" {
		req.AttendanceURL = defaultAttendanceURL
	}
	if req.RefererURL == "" {
		req.RefererURL = defaultRefererURL
	}
	if req.UserAgent == "" {
		req.UserAgent = defaultUserAgent
	}

	attendanceURL, err := url.Parse(req.AttendanceURL)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success: false,
			Error:   "invalid attendanceUrl: " + err.Error(),
		})
		os.Exit(1)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success: false,
			Error:   "could not create cookie jar: " + err.Error(),
		})
		os.Exit(1)
	}

	setCookies(jar, attendanceURL, req.Cookies)

	client := &http.Client{
		Jar: jar,
	}

	httpReq, err := http.NewRequest(http.MethodGet, attendanceURL.String(), nil)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success: false,
			Error:   "could not create request: " + err.Error(),
		})
		os.Exit(1)
	}

	httpReq.Header.Set("User-Agent", req.UserAgent)
	httpReq.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	httpReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	httpReq.Header.Set("X-Requested-With", "XMLHttpRequest")
	httpReq.Header.Set("Referer", req.RefererURL)

	httpRes, err := client.Do(httpReq)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success: false,
			URL:     attendanceURL.String(),
			Error:   "request failed: " + err.Error(),
		})
		os.Exit(1)
	}
	defer httpRes.Body.Close()

	body, err := io.ReadAll(httpRes.Body)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success:    false,
			StatusCode: httpRes.StatusCode,
			URL:        attendanceURL.String(),
			Error:      "could not read response body: " + err.Error(),
		})
		os.Exit(1)
	}

	decoded, payload, err := decodeSanitizedHTML(string(body))
	debug := DebugInfo{
		PayloadFound:        payload != "",
		PayloadLength:       len(payload),
		ResponseContentType: httpRes.Header.Get("Content-Type"),
	}
	if decoded != "" {
		debug.DecodedLength = len(decoded)
		debug.DecodedHasCourse = strings.Contains(decoded, "Course Code")
		debug.DecodedHasAttn = strings.Contains(decoded, "Attn %")
		debug.DecodedHasHours = strings.Contains(decoded, "Hours Conducted")
	}

	if err != nil {
		writeJSON(AttendanceResponse{
			Success:    false,
			StatusCode: httpRes.StatusCode,
			URL:        attendanceURL.String(),
			Debug:      debug,
			Error:      err.Error(),
		})
		os.Exit(1)
	}

	records, headers, err := parseAttendance(decoded)
	debug.MatchedHeaders = headers
	debug.MatchedRowCount = len(records)
	if err != nil {
		writeJSON(AttendanceResponse{
			Success:    false,
			StatusCode: httpRes.StatusCode,
			URL:        attendanceURL.String(),
			Debug:      debug,
			Error:      err.Error(),
		})
		os.Exit(1)
	}

	writeJSON(AttendanceResponse{
		Success:    httpRes.StatusCode >= 200 && httpRes.StatusCode < 300,
		StatusCode: httpRes.StatusCode,
		URL:        attendanceURL.String(),
		Debug:      debug,
		Attendance: records,
	})
}

func setCookies(jar *cookiejar.Jar, targetURL *url.URL, src []InputCookie) {
	cookies := make([]*http.Cookie, 0, len(src))
	for _, c := range src {
		cookie := &http.Cookie{
			Name:     c.Name,
			Value:    c.Value,
			Path:     c.Path,
			Domain:   c.Domain,
			HttpOnly: c.HTTPOnly,
			Secure:   c.Secure,
		}
		if cookie.Path == "" {
			cookie.Path = "/"
		}
		if cookie.Domain == "" {
			cookie.Domain = targetURL.Hostname()
		}
		if c.Expires > 0 {
			cookie.Expires = time.Unix(int64(c.Expires), 0).UTC()
		}
		cookies = append(cookies, cookie)
	}
	jar.SetCookies(targetURL, cookies)
}

func decodeSanitizedHTML(raw string) (decoded string, payload string, err error) {
	payload, err = extractSanitizePayload(raw)
	if err != nil {
		return "", "", err
	}

	decoded, err = decodeJSString(payload)
	if err != nil {
		return "", payload, fmt.Errorf("could not decode sanitize payload: %w", err)
	}
	return decoded, payload, nil
}

func extractSanitizePayload(raw string) (string, error) {
	const marker = "pageSanitizer.sanitize('"

	start := strings.Index(raw, marker)
	if start < 0 {
		return "", fmt.Errorf("pageSanitizer payload marker not found")
	}

	i := start + len(marker)
	var b strings.Builder
	for i < len(raw) {
		ch := raw[i]

		if ch == '\\' {
			if i+1 >= len(raw) {
				return "", fmt.Errorf("unterminated escape sequence in sanitize payload")
			}
			b.WriteByte(raw[i])
			b.WriteByte(raw[i+1])
			i += 2
			continue
		}

		if ch == '\'' {
			return b.String(), nil
		}

		b.WriteByte(ch)
		i++
	}

	return "", fmt.Errorf("unterminated sanitize payload")
}

func decodeJSString(s string) (string, error) {
	var b strings.Builder

	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			b.WriteByte(s[i])
			continue
		}

		i++
		if i >= len(s) {
			return "", fmt.Errorf("unterminated escape")
		}

		switch s[i] {
		case 'x':
			if i+2 >= len(s) {
				return "", fmt.Errorf("short hex escape")
			}
			v, err := strconv.ParseUint(s[i+1:i+3], 16, 8)
			if err != nil {
				return "", err
			}
			b.WriteByte(byte(v))
			i += 2
		case 'u':
			if i+4 >= len(s) {
				return "", fmt.Errorf("short unicode escape")
			}
			v, err := strconv.ParseUint(s[i+1:i+5], 16, 16)
			if err != nil {
				return "", err
			}
			b.WriteRune(rune(v))
			i += 4
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		case 'b':
			b.WriteByte('\b')
		case 'f':
			b.WriteByte('\f')
		case '\\', '\'', '"', '/':
			b.WriteByte(s[i])
		default:
			b.WriteByte(s[i])
		}
	}

	return b.String(), nil
}

func parseAttendance(decodedHTML string) ([]AttendanceRecord, []string, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return nil, nil, fmt.Errorf("could not parse decoded HTML: %w", err)
	}

	var table *goquery.Selection
	var headers []string

	doc.Find("table").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		rowHeaders := extractHeaders(sel)
		if len(rowHeaders) < 2 {
			return true
		}
		if contains(rowHeaders, "Attn %") {
			table = sel
			headers = rowHeaders
			return false
		}
		return true
	})

	if table == nil {
		return nil, nil, fmt.Errorf("attendance table not found in decoded HTML")
	}

	var records []AttendanceRecord
	table.Find("tr").Each(func(index int, row *goquery.Selection) {
		if index == 0 {
			return
		}

		cells := extractCells(row)
		if len(cells) == 0 || strings.TrimSpace(cells[0]) == "" {
			return
		}

		recordMap := make(map[string]string, len(headers))
		for i, header := range headers {
			if i < len(cells) {
				recordMap[header] = cells[i]
			} else {
				recordMap[header] = ""
			}
		}

		records = append(records, AttendanceRecord{
			CourseCode:     strings.TrimSpace(strings.Split(recordMap["Course Code"], "\n")[0]),
			CourseTitle:    recordMap["Course Title"],
			Category:       recordMap["Category"],
			FacultyName:    recordMap["Faculty Name"],
			Slot:           recordMap["Slot"],
			RoomNo:         recordMap["Room No"],
			HoursConducted: recordMap["Hours Conducted"],
			HoursAbsent:    recordMap["Hours Absent"],
			AttendancePct:  recordMap["Attn %"],
		})
	})

	if len(records) == 0 {
		return nil, headers, fmt.Errorf("attendance table parsed but contained no data rows")
	}

	return records, headers, nil
}

func extractHeaders(table *goquery.Selection) []string {
	firstRow := table.Find("tr").First()
	return extractCells(firstRow)
}

func extractCells(row *goquery.Selection) []string {
	var cells []string
	row.Find("th,td").Each(func(_ int, cell *goquery.Selection) {
		cells = append(cells, extractCellText(cell))
	})
	return cells
}

func extractCellText(cell *goquery.Selection) string {
	var b strings.Builder
	for _, node := range cell.Nodes {
		walkNodeText(&b, node)
	}

	text := b.String()
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.Join(strings.Fields(line), " ")
	}

	normalized := strings.Join(lines, "\n")
	normalized = strings.TrimSpace(normalized)

	for strings.Contains(normalized, "\n\n") {
		normalized = strings.ReplaceAll(normalized, "\n\n", "\n")
	}

	return normalized
}

func walkNodeText(b *strings.Builder, node *html.Node) {
	if node == nil {
		return
	}

	switch node.Type {
	case html.TextNode:
		b.WriteString(node.Data)
		return
	case html.ElementNode:
		if isLineBreakNode(node.Data) && !strings.HasSuffix(b.String(), "\n") {
			b.WriteByte('\n')
		}
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkNodeText(b, child)
	}

	if node.Type == html.ElementNode && isBlockNode(node.Data) && !strings.HasSuffix(b.String(), "\n") {
		b.WriteByte('\n')
	}
}

func isLineBreakNode(tag string) bool {
	switch tag {
	case "br", "hr":
		return true
	default:
		return false
	}
}

func isBlockNode(tag string) bool {
	switch tag {
	case "div", "p", "section", "article", "header", "footer", "li", "tr", "table":
		return true
	default:
		return false
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}

func writeJSON(v AttendanceResponse) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		fmt.Fprintln(os.Stderr, "could not encode JSON:", err)
	}
}
