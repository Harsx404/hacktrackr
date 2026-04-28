package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	stdhtml "html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

const (
	defaultBaseURL              = "https://academia.srmist.edu.in"
	defaultPortalID             = "40-10002227248"
	defaultStudentPhotoReportID = "2727643000298055031"
	defaultSigninPath           = "/accounts/p/" + defaultPortalID + "/signin"
	defaultAttendanceURL        = defaultBaseURL + "/srm_university/academia-academic-services/page/My_Attendance"
	defaultPersonalTTURL        = defaultBaseURL + "/srm_university/academia-academic-services/page/My_Time_Table_2023_24"
	defaultUnifiedTTB1          = defaultBaseURL + "/srm_university/academia-academic-services/page/Unified_Time_Table_2025_Batch_1"
	defaultUnifiedTTB2          = defaultBaseURL + "/srm_university/academia-academic-services/page/Unified_Time_Table_2025_batch_2"
	defaultCalendarOdd          = defaultBaseURL + "/srm_university/academia-academic-services/page/Academic_Planner_2025_26_ODD"
	defaultCalendarEven         = defaultBaseURL + "/srm_university/academia-academic-services/page/Academic_Planner_2025_26_EVEN"
	defaultUserAgent            = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

const (
	classAuthenticated = "authenticated_session_established"
	classInvalidCreds  = "invalid_credentials"
	classSessions      = "session_reminder_or_active_sessions"
	classDailyLimit    = "daily_signin_warning"
	classCaptcha       = "captcha_or_antibot_challenge"
	classJSDependent   = "js_dependent_flow_or_waf_block"
	classUnknown       = "unknown_intermediate_page"
)

type ProbeRequest struct {
	Mode          string             `json:"mode"`
	Email         string             `json:"email"`
	Password      string             `json:"password"`
	BaseURL       string             `json:"baseUrl"`
	SigninURL     string             `json:"signinUrl"`
	AttendanceURL string             `json:"attendanceUrl"`
	UserAgent     string             `json:"userAgent"`
	Cookies       []SerializedCookie `json:"cookies,omitempty"`
	Sections      []string           `json:"sections,omitempty"`
	CalendarSems  []string           `json:"calendarSems,omitempty"`
	LoginOnly     bool               `json:"loginOnly"`
}

type HiddenField struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type SigninPageInfo struct {
	FinalURL        string        `json:"finalUrl"`
	URIPathPrefix   string        `json:"uriPathPrefix"`
	ServiceURL      string        `json:"serviceUrl"`
	CSRFParam       string        `json:"csrfParam"`
	CSRFCookieName  string        `json:"csrfCookieName"`
	EmailOnlySignin bool          `json:"emailOnlySignin"`
	HiddenFields    []HiddenField `json:"hiddenFields,omitempty"`
}

type RequestTrace struct {
	Name        string `json:"name"`
	Method      string `json:"method"`
	URL         string `json:"url"`
	StatusCode  int    `json:"statusCode"`
	Location    string `json:"location,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	BodyLength  int    `json:"bodyLength,omitempty"`
}

type LookupSummary struct {
	Attempted        bool     `json:"attempted"`
	StatusCode       int      `json:"statusCode"`
	Code             string   `json:"code,omitempty"`
	ResourceName     string   `json:"resourceName,omitempty"`
	AllowedModes     []string `json:"allowedModes,omitempty"`
	Identifier       string   `json:"identifier,omitempty"`
	LocalizedMessage string   `json:"localizedMessage,omitempty"`
	ErrorCode        string   `json:"errorCode,omitempty"`
}

type PasswordSummary struct {
	Attempted        bool   `json:"attempted"`
	StatusCode       int    `json:"statusCode"`
	Code             string `json:"code,omitempty"`
	ResourceName     string `json:"resourceName,omitempty"`
	LocalizedMessage string `json:"localizedMessage,omitempty"`
	ErrorCode        string `json:"errorCode,omitempty"`
	RedirectURI      string `json:"redirectUri,omitempty"`
	Status           string `json:"status,omitempty"`
	Location         string `json:"location,omitempty"`
}

type AttendanceDebug struct {
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

type MarkTest struct {
	TestName string `json:"testName"`
	MaxScore string `json:"maxScore"`
	Score    string `json:"score"`
}

type MarkRecord struct {
	CourseCode string     `json:"courseCode"`
	CourseType string     `json:"courseType"`
	Tests      []MarkTest `json:"tests"`
}

type Advisor struct {
	Name  string `json:"name"`
	Role  string `json:"role"`
	Email string `json:"email"`
	Phone string `json:"phone"`
}

type ScheduleEntry struct {
	Day       string `json:"day"`
	HourIndex int    `json:"hourIndex"`
	Timing    string `json:"timing"`
	SlotToken string `json:"slotToken"`
}

type TimetableCourse struct {
	CourseCode  string          `json:"courseCode"`
	CourseTitle string          `json:"courseTitle"`
	Credit      string          `json:"credit"`
	Category    string          `json:"category"`
	CourseType  string          `json:"courseType"`
	FacultyName string          `json:"facultyName"`
	Slot        string          `json:"slot"`
	RoomNo      string          `json:"roomNo"`
	Schedule    []ScheduleEntry `json:"schedule"`
}

type TimetableResult struct {
	Batch    string            `json:"batch"`
	Courses  []TimetableCourse `json:"courses"`
	Advisors []Advisor         `json:"advisors"`
}

type CalendarDay struct {
	Date     string `json:"date"`
	Day      string `json:"day"`
	Event    string `json:"event"`
	DayOrder string `json:"dayOrder"`
}

type CalendarMonth struct {
	Name string        `json:"name"`
	Days []CalendarDay `json:"days"`
}

type CalendarResult struct {
	Sem    string          `json:"sem"`
	Title  string          `json:"title"`
	Months []CalendarMonth `json:"months"`
}

type AttendanceSummary struct {
	Attempted  bool            `json:"attempted"`
	Success    bool            `json:"success"`
	StatusCode int             `json:"statusCode"`
	Rows       int             `json:"rows"`
	Debug      AttendanceDebug `json:"debug"`
	Error      string          `json:"error,omitempty"`
}

type FetchData struct {
	StudentInfo map[string]string         `json:"studentInfo,omitempty"`
	Attendance  []AttendanceRecord        `json:"attendance,omitempty"`
	Marks       []MarkRecord              `json:"marks,omitempty"`
	Timetable   *TimetableResult          `json:"timetable,omitempty"`
	Calendars   map[string]CalendarResult `json:"calendars,omitempty"`
	Errors      map[string]string         `json:"errors,omitempty"`
}

type ProbeResponse struct {
	Success         bool               `json:"success"`
	Classification  string             `json:"classification"`
	FinalURL        string             `json:"finalUrl,omitempty"`
	CookieNames     []string           `json:"cookieNames,omitempty"`
	Cookies         []SerializedCookie `json:"cookies,omitempty"`
	HasJSessionID   bool               `json:"hasJsessionId"`
	SigninPage      SigninPageInfo     `json:"signinPage"`
	Lookup          LookupSummary      `json:"lookup"`
	Password        PasswordSummary    `json:"password"`
	RedirectSummary []RequestTrace     `json:"redirectSummary,omitempty"`
	Attendance      AttendanceSummary  `json:"attendance"`
	Data            FetchData          `json:"data"`
	Error           string             `json:"error,omitempty"`
}

type requestSnapshot struct {
	name       string
	method     string
	url        string
	statusCode int
	location   string
	body       []byte
	headers    http.Header
}

type lookupResult struct {
	summary    LookupSummary
	identifier string
	digest     string
}

type passwordResult struct {
	summary     PasswordSummary
	redirectURI string
}

type sessionAction struct {
	name        string
	method      string
	url         string
	body        []byte
	contentType string
}

type probe struct {
	req                   ProbeRequest
	client                *http.Client
	jar                   *cookiejar.Jar
	resp                  ProbeResponse
	signinURL             string
	serviceURL            string
	attendanceURL         string
	userAgent             string
	uriPrefix             string
	csrfParam             string
	csrfCookieName        string
	cliTime               string
	baseURL               *url.URL
	mode                  string
	requestedSections     map[string]bool
	requestedCalendarSems []string
	authenticatedEvidence bool
}

var regexpCache = map[string]*regexp.Regexp{}

func main() {
	var req ProbeRequest
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		writeJSON(ProbeResponse{
			Success:        false,
			Classification: classJSDependent,
			Error:          "could not decode stdin JSON: " + err.Error(),
		})
		os.Exit(1)
	}

	mode := normalizeMode(req)
	if strings.TrimSpace(req.Email) == "" {
		writeJSON(ProbeResponse{
			Success:        false,
			Classification: classUnknown,
			Error:          "email is required",
		})
		os.Exit(1)
	}
	if mode != modeFetch && strings.TrimSpace(req.Password) == "" {
		writeJSON(ProbeResponse{
			Success:        false,
			Classification: classUnknown,
			Error:          "password is required for login modes",
		})
		os.Exit(1)
	}
	if mode == modeFetch && len(req.Cookies) == 0 {
		writeJSON(ProbeResponse{
			Success:        false,
			Classification: classUnknown,
			Error:          "cookies are required for fetch mode",
		})
		os.Exit(1)
	}

	result := runProbe(req)
	writeJSON(result)
	if !result.Success {
		os.Exit(1)
	}
}

func runProbe(req ProbeRequest) ProbeResponse {
	base := strings.TrimSpace(req.BaseURL)
	if base == "" {
		base = defaultBaseURL
	}

	serviceURL := base
	signinURL := strings.TrimSpace(req.SigninURL)
	if signinURL == "" {
		signinURL = base + defaultSigninPath + "?serviceurl=" + url.QueryEscape(serviceURL)
	}

	attendanceURL := strings.TrimSpace(req.AttendanceURL)
	if attendanceURL == "" {
		attendanceURL = defaultAttendanceURL
	}

	userAgent := strings.TrimSpace(req.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}

	baseURL, err := url.Parse(base)
	if err != nil {
		return ProbeResponse{
			Success:        false,
			Classification: classUnknown,
			Error:          "invalid base URL: " + err.Error(),
		}
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		return ProbeResponse{
			Success:        false,
			Classification: classUnknown,
			Error:          "could not create cookie jar: " + err.Error(),
		}
	}

	p := &probe{
		req: req,
		client: &http.Client{
			Jar: jar,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		jar:                   jar,
		resp:                  ProbeResponse{Classification: classUnknown},
		signinURL:             signinURL,
		serviceURL:            serviceURL,
		attendanceURL:         attendanceURL,
		userAgent:             userAgent,
		csrfParam:             "iamcsrcoo",
		csrfCookieName:        "iamcsr",
		cliTime:               strconvMillis(time.Now().UTC()),
		baseURL:               baseURL,
		mode:                  normalizeMode(req),
		requestedSections:     normalizeRequestedSections(req, normalizeMode(req)),
		requestedCalendarSems: normalizeRequestedCalendarSems(req, normalizeMode(req)),
	}
	p.seedCookies(req.Cookies)

	if err := p.execute(); err != nil && p.resp.Error == "" {
		p.resp.Error = err.Error()
	}

	p.resp.Cookies = p.serializedCookies()
	p.resp.CookieNames = p.cookieNames()
	p.resp.HasJSessionID = containsString(p.resp.CookieNames, "JSESSIONID")
	if p.resp.FinalURL == "" {
		p.resp.FinalURL = p.signinURL
	}
	if p.resp.Classification == "" {
		p.resp.Classification = classUnknown
	}
	return p.resp
}

func (p *probe) execute() error {
	if p.mode == modeFetch {
		return p.executeFetchOnly()
	}

	signinSnap, err := p.doRequest("signin_page", http.MethodGet, p.signinURL, nil, "", nil, true)
	if err != nil {
		p.resp.Classification = classJSDependent
		return fmt.Errorf("could not fetch sign-in page: %w", err)
	}

	signinInfo, err := parseSigninPage(signinSnap.body, signinSnap.url, p.serviceURL)
	if err != nil {
		p.resp.Classification = classJSDependent
		return fmt.Errorf("could not parse sign-in page: %w", err)
	}

	p.resp.SigninPage = signinInfo
	p.resp.FinalURL = signinSnap.url
	if signinInfo.URIPathPrefix != "" {
		p.uriPrefix = signinInfo.URIPathPrefix
	} else {
		p.uriPrefix = "/accounts/p/" + defaultPortalID
	}
	if signinInfo.ServiceURL != "" {
		p.serviceURL = signinInfo.ServiceURL
	}
	if signinInfo.CSRFParam != "" {
		p.csrfParam = signinInfo.CSRFParam
	}
	if signinInfo.CSRFCookieName != "" {
		p.csrfCookieName = signinInfo.CSRFCookieName
	}

	classification, message := classifyPage(signinSnap.url, string(signinSnap.body))
	if classification != "" && classification != classUnknown {
		p.resp.Classification = classification
		p.resp.Error = message
		return nil
	}

	if _, err := p.runLocate(); err != nil {
		p.resp.Classification = classJSDependent
		return err
	}

	lookup, err := p.runLookup()
	p.resp.Lookup = lookup.summary
	if err != nil {
		if p.resp.Classification == "" || p.resp.Classification == classUnknown {
			p.resp.Classification = classifyFromMessage(lookup.summary.LocalizedMessage, lookup.summary.ErrorCode)
		}
		return err
	}

	password, err := p.runPassword(lookup.identifier, lookup.digest)
	p.resp.Password = password.summary
	if err != nil {
		if p.resp.Classification == "" || p.resp.Classification == classUnknown {
			p.resp.Classification = classifyFromMessage(password.summary.LocalizedMessage, password.summary.ErrorCode)
		}
		return err
	}

	finalTarget := strings.TrimSpace(password.redirectURI)
	if finalTarget == "" {
		finalTarget = p.serviceURL
	}

	finalSnap, err := p.doRequest("post_login_navigation", http.MethodGet, finalTarget, nil, "", nil, true)
	if err != nil {
		p.resp.Classification = classUnknown
		return fmt.Errorf("could not open post-login target: %w", err)
	}

	finalSnap, err = p.completePostLoginFlow(finalSnap)
	if err != nil {
		p.resp.Classification = classUnknown
		p.resp.Error = err.Error()
		return err
	}

	p.resp.FinalURL = finalSnap.url
	classification, message = classifyPage(finalSnap.url, string(finalSnap.body))
	if classification != "" && classification != classUnknown {
		p.resp.Classification = classification
		p.resp.Error = message
		return nil
	}

	if p.mode == modeLogin {
		if p.looksAuthenticated(finalSnap) {
			p.resp.Success = true
			p.resp.Classification = classAuthenticated
			return nil
		}
		p.resp.Classification = classUnknown
		p.resp.Error = "login flow completed but authenticated portal session was not established"
		return nil
	}

	if err := p.fetchRequestedSections(); err != nil {
		if p.resp.Classification == "" {
			p.resp.Classification = classUnknown
		}
		return err
	}
	return nil
}

func (p *probe) completePostLoginFlow(current requestSnapshot) (requestSnapshot, error) {
	last := current
	for step := 0; step < 6; step++ {
		classification, _ := classifyPage(last.url, string(last.body))
		switch classification {
		case classSessions:
			next, err := p.completeSessionTermination(last)
			if err != nil {
				return last, err
			}
			last = next
		case classDailyLimit:
			next, err := p.completeDailySigninWarning(last)
			if err != nil {
				return last, err
			}
			last = next
		default:
			return last, nil
		}
	}
	return last, fmt.Errorf("post-login flow did not settle after multiple continuation steps")
}

func (p *probe) completeSessionTermination(current requestSnapshot) (requestSnapshot, error) {
	last := current
	for step := 0; step < 4; step++ {
		classification, _ := classifyPage(last.url, string(last.body))
		if classification != classSessions {
			return last, nil
		}

		if strings.Contains(strings.ToLower(last.url), "/preannouncement/block-sessions") {
			next, err := p.completePreannouncementSessionTermination(last)
			if err != nil {
				return last, err
			}
			last = next
			continue
		}

		actions := extractContinuationActions(string(last.body), last.url)
		if len(actions) == 0 {
			actionURL := extractSessionContinueURL(string(last.body), last.url)
			if actionURL == "" {
				actionURL = deriveSessionContinueURL(last.url)
			}
			if actionURL != "" {
				actions = append(actions, sessionAction{
					name:   "session_terminate_fallback",
					method: http.MethodGet,
					url:    actionURL,
				})
			}
		}
		if len(actions) == 0 {
			return last, fmt.Errorf("session reminder page did not expose a terminate action")
		}

		var lastErr error
		progressed := false
		for _, action := range actions {
			snap, err := p.doRequest(action.name, action.method, action.url, action.body, action.contentType, map[string]string{
				"Accept":  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Referer": last.url,
			}, true)
			if err != nil {
				lastErr = err
				continue
			}
			last = snap
			progressed = true
			classification, _ = classifyPage(last.url, string(last.body))
			if classification != classSessions {
				return last, nil
			}
		}

		if !progressed {
			if lastErr != nil {
				return last, fmt.Errorf("session termination request failed: %w", lastErr)
			}
			return last, fmt.Errorf("session termination actions did not change the page state")
		}
	}

	return last, fmt.Errorf("session reminder flow did not complete after multiple attempts")
}

func (p *probe) completePreannouncementSessionTermination(current requestSnapshot) (requestSnapshot, error) {
	deleteURL := derivePreannouncementDeleteURL(current.url)
	if deleteURL == "" {
		return current, fmt.Errorf("preannouncement block-sessions page did not expose a terminate endpoint")
	}

	deleteSnap, err := p.doRequest("session_terminate_delete", http.MethodDelete, deleteURL, nil, "", map[string]string{
		"Accept":           "application/json,text/plain,*/*",
		"X-Requested-With": "XMLHttpRequest",
		"Referer":          current.url,
	}, false)
	if err != nil {
		return current, fmt.Errorf("preannouncement terminate request failed: %w", err)
	}
	if deleteSnap.statusCode < 200 || deleteSnap.statusCode > 299 {
		return current, fmt.Errorf("preannouncement terminate request returned %d", deleteSnap.statusCode)
	}

	actionURL := deriveSessionContinueURL(current.url)
	if actionURL == "" {
		return current, fmt.Errorf("preannouncement block-sessions page did not expose a continuation URL")
	}

	nextSnap, err := p.doRequest("session_terminate_next", http.MethodGet, actionURL, nil, "", map[string]string{
		"Accept":  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Referer": current.url,
	}, true)
	if err != nil {
		return current, fmt.Errorf("preannouncement continuation request failed: %w", err)
	}
	return nextSnap, nil
}

func (p *probe) completeDailySigninWarning(current requestSnapshot) (requestSnapshot, error) {
	actions := extractContinuationActions(string(current.body), current.url)
	if len(actions) == 0 {
		actionURL := extractSessionContinueURL(string(current.body), current.url)
		if actionURL == "" {
			actionURL = deriveSessionContinueURL(current.url)
		}
		if actionURL != "" {
			actions = append(actions, sessionAction{
				name:   "daily_signin_continue_fallback",
				method: http.MethodGet,
				url:    actionURL,
			})
		}
	}
	if len(actions) == 0 {
		return current, fmt.Errorf("daily sign-in warning page did not expose an acknowledgement action")
	}

	var lastErr error
	for _, action := range actions {
		snap, err := p.doRequest(action.name, action.method, action.url, action.body, action.contentType, map[string]string{
			"Accept":  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Referer": current.url,
		}, true)
		if err != nil {
			lastErr = err
			continue
		}
		return snap, nil
	}

	if lastErr != nil {
		return current, fmt.Errorf("daily sign-in acknowledgement failed: %w", lastErr)
	}
	return current, fmt.Errorf("daily sign-in acknowledgement failed")
}

func (p *probe) looksAuthenticated(current requestSnapshot) bool {
	if containsString(p.cookieNames(), "JSESSIONID") {
		return true
	}
	lowerURL := strings.ToLower(current.url)
	return strings.HasPrefix(lowerURL, strings.ToLower(p.serviceURL)) &&
		!strings.Contains(lowerURL, "/accounts/p/") &&
		!strings.Contains(lowerURL, "/signin")
}

func (p *probe) runLocate() (requestSnapshot, error) {
	locateURL := p.serviceURL + p.uriPrefix + "/accounts/public/api/locate?cli_time=" + url.QueryEscape(p.cliTime) + "&serviceurl=" + url.QueryEscape(p.serviceURL)
	snap, err := p.doRequest("locate", http.MethodPost, locateURL, nil, "application/x-www-form-urlencoded;charset=UTF-8", map[string]string{
		"Accept": "application/json,text/plain,*/*",
	}, false)
	if err != nil {
		return snap, fmt.Errorf("locate request failed: %w", err)
	}
	if snap.statusCode < 200 || snap.statusCode > 299 {
		return snap, fmt.Errorf("locate request returned %d", snap.statusCode)
	}
	return snap, nil
}

func (p *probe) runLookup() (lookupResult, error) {
	encodedEmail := url.PathEscape(strings.TrimSpace(p.req.Email))
	lookupURL := p.serviceURL + p.uriPrefix + "/signin/v2/lookup/" + encodedEmail
	body := []byte("mode=primary&cli_time=" + url.QueryEscape(p.cliTime) + "&serviceurl=" + url.QueryEscape(p.serviceURL))
	snap, err := p.doRequest("lookup", http.MethodPost, lookupURL, body, "application/x-www-form-urlencoded;charset=UTF-8", map[string]string{
		"Accept": "application/json,text/plain,*/*",
	}, false)
	result := parseLookupResponse(snap.body)
	result.summary.Attempted = true
	result.summary.StatusCode = snap.statusCode
	if err != nil {
		p.resp.Classification = classJSDependent
		return result, fmt.Errorf("lookup request failed: %w", err)
	}
	if snap.statusCode < 200 || snap.statusCode > 299 {
		p.resp.Classification = classifyFromMessage(result.summary.LocalizedMessage, result.summary.ErrorCode)
		if p.resp.Classification == classUnknown {
			p.resp.Classification = classJSDependent
		}
		return result, fmt.Errorf("lookup request returned %d", snap.statusCode)
	}
	if result.identifier == "" || result.digest == "" {
		p.resp.Classification = classifyFromMessage(result.summary.LocalizedMessage, result.summary.ErrorCode)
		if p.resp.Classification == classUnknown {
			p.resp.Classification = classJSDependent
		}
		return result, fmt.Errorf("lookup response did not contain identifier/digest")
	}
	return result, nil
}

func (p *probe) runPassword(identifier, digest string) (passwordResult, error) {
	passwordURL := p.serviceURL + p.uriPrefix + "/signin/v2/primary/" + url.PathEscape(identifier) + "/password?digest=" + url.QueryEscape(digest) + "&cli_time=" + url.QueryEscape(p.cliTime) + "&serviceurl=" + url.QueryEscape(p.serviceURL)
	body := []byte(`{"passwordauth":{"password":` + strconvQuote(strings.TrimSpace(p.req.Password)) + `}}`)
	snap, err := p.doRequest("password", http.MethodPost, passwordURL, body, "application/x-www-form-urlencoded;charset=UTF-8", map[string]string{
		"Accept": "application/json,text/plain,*/*",
	}, false)
	result := parsePasswordResponse(snap.body, snap.location)
	result.summary.Attempted = true
	result.summary.StatusCode = snap.statusCode
	result.summary.Location = snap.location
	if err != nil {
		p.resp.Classification = classJSDependent
		return result, fmt.Errorf("password request failed: %w", err)
	}
	if snap.statusCode < 200 || snap.statusCode > 299 {
		p.resp.Classification = classifyFromMessage(result.summary.LocalizedMessage, result.summary.ErrorCode)
		if p.resp.Classification == classUnknown {
			p.resp.Classification = classJSDependent
		}
		return result, fmt.Errorf("password request returned %d", snap.statusCode)
	}

	switch result.summary.Code {
	case "SI302", "SI200", "SI300", "SI301", "SI303", "SI305", "SI507", "SI509", "SI506":
		if strings.TrimSpace(result.redirectURI) == "" {
			result.redirectURI = p.serviceURL
		}
		return result, nil
	case "":
		if snap.statusCode >= 200 && snap.statusCode <= 299 {
			if strings.TrimSpace(result.redirectURI) == "" {
				result.redirectURI = p.serviceURL
			}
			result.summary.Code = "EMPTY_2XX"
			result.summary.Status = "accepted_without_json"
			return result, nil
		}
		p.resp.Classification = classJSDependent
		return result, fmt.Errorf("password response body was empty or unreadable")
	default:
		p.resp.Classification = classifyFromMessage(result.summary.LocalizedMessage, result.summary.ErrorCode)
		return result, fmt.Errorf("password response code %s did not establish a direct session", result.summary.Code)
	}
}

func (p *probe) fetchAllSections() error {
	return p.fetchRequestedSections()
}

func (p *probe) fetchAttendanceBundle(required map[string]bool) (AttendanceSummary, error) {
	summary := AttendanceSummary{Attempted: true}
	decoded, debug, err := p.fetchDecodedFragment(
		"attendance",
		p.attendanceURL,
		p.serviceURL+"/#Page:My_Attendance",
	)
	summary.StatusCode = debug.statusCode
	summary.Debug.ResponseContentType = debug.contentType
	summary.Debug.PayloadFound = debug.payloadFound
	summary.Debug.PayloadLength = debug.payloadLength
	summary.Debug.DecodedLength = len(decoded)
	summary.Debug.DecodedHasCourse = strings.Contains(decoded, "Course Code")
	summary.Debug.DecodedHasAttn = strings.Contains(decoded, "Attn %")
	summary.Debug.DecodedHasHours = strings.Contains(decoded, "Hours Conducted")
	if err != nil {
		summary.Error = err.Error()
		return summary, fmt.Errorf("%s", summary.Error)
	}

	records, headers, err := parseAttendance(decoded)
	summary.Debug.MatchedHeaders = headers
	summary.Debug.MatchedRowCount = len(records)
	if err != nil {
		if required["attendance"] {
			summary.Error = err.Error()
			return summary, fmt.Errorf("%s", summary.Error)
		}
		p.recordSectionError("attendance", err)
	}

	attendance := []AttendanceRecord{}
	if err == nil {
		attendance = mapAttendanceRows(records)
	}
	info, infoErr := parseStudentInfoHTML(decoded)
	if infoErr != nil {
		p.recordSectionError("studentInfo", infoErr)
	} else if len(info) > 0 {
		photoCandidate, _ := extractStudentPhotoDownloadURL(decoded)
		if photoCandidate == "" {
			photoCandidate, _ = extractStudentPhotoSource(decoded)
		}
		if photoCandidate != "" {
			if photoDataURL, photoErr := p.fetchStudentPhotoDataURL(photoCandidate); photoErr == nil {
				info["PhotoUrl"] = photoDataURL
			} else {
				info["PhotoUrl"] = photoCandidate
			}
		}

		if info["PhotoUrl"] == "" {
			snap, reqErr := p.doRequest(
				"student_profile_report",
				http.MethodGet,
				p.serviceURL+"/srm_university/academia-academic-services/report/Student_Profile_Report",
				nil,
				"",
				map[string]string{
					"X-Requested-With": "XMLHttpRequest",
					"Referer":          p.serviceURL + "/#Report:Student_Profile_Report",
				},
				true,
			)

			profileHTML := ""
			if reqErr == nil && snap.statusCode == 200 {
				profileHTML = string(snap.body)
			}

			if profileHTML != "" {
				// The photo is embedded inside a JSON literal object at the end of the file.
				// e.g. "MODEL":{"ACTUALAPPLINKNAME"... "DATAJSONARRAY":[{"Name":"...","Your_Photo":"<a ...><img src=\"/srm_univer..."}]}}
				var photoRawHTML string

				// Try to extract the whole JSON blob
				startIdx := strings.Index(profileHTML, `{"HTML":`)
				if startIdx >= 0 {
					var parsedData struct {
						Model struct {
							DataJSONArray []map[string]any `json:"DATAJSONARRAY"`
						} `json:"MODEL"`
					}
					if err := json.Unmarshal([]byte(profileHTML[startIdx:]), &parsedData); err == nil {
						if len(parsedData.Model.DataJSONArray) > 0 {
							if photoVal, ok := parsedData.Model.DataJSONArray[0]["Your_Photo"].(string); ok {
								photoRawHTML = photoVal
							}
						}
					}
				}

				// If JSON decode failed, fallback to simple string search
				if photoRawHTML == "" {
					marker := `"Your_Photo":"`
					if idx := strings.Index(profileHTML, marker); idx >= 0 {
						endIdx := strings.Index(profileHTML[idx+len(marker):], `"}}`)
						if endIdx >= 0 {
							// unescape JSON string
							rawValue := profileHTML[idx+len(marker) : idx+len(marker)+endIdx]
							rawValue = strings.ReplaceAll(rawValue, `\"`, `"`)
							rawValue = strings.ReplaceAll(rawValue, `\/`, `/`)
							photoRawHTML = rawValue
						}
					}
				}

				var photoCandidate string
				if photoRawHTML != "" {
					photoCandidate, _ = extractStudentPhotoDownloadURL("<html>" + photoRawHTML + "</html>")
					if photoCandidate == "" {
						photoCandidate, _ = extractStudentPhotoSource("<html>" + photoRawHTML + "</html>")
					}
				}

				// If still nothing, try the whole document just in case
				if photoCandidate == "" {
					photoCandidate, _ = extractStudentPhotoDownloadURL(profileHTML)
					if photoCandidate == "" {
						photoCandidate, _ = extractStudentPhotoSource(profileHTML)
					}
				}

				if photoCandidate != "" {
					// Match the old Playwright path: fetch the actual image bytes from
					// the SRM download-file endpoint and return them as a data URL.
					if photoDataURL, photoErr := p.fetchStudentPhotoDataURL(photoCandidate); photoErr == nil {
						info["PhotoUrl"] = photoDataURL
					}

					// Fallback if the direct image fetch fails but we still have the URL.
					if info["PhotoUrl"] == "" {
						info["PhotoUrl"] = photoCandidate
					}
				}
			}
		}

		p.resp.Data.StudentInfo = info
	}

	marks, marksErr := parseMarksHTML(decoded)
	if marksErr != nil {
		p.recordSectionError("marks", marksErr)
	} else if len(marks) > 0 {
		p.resp.Data.Marks = marks
	}

	if len(attendance) > 0 {
		p.resp.Data.Attendance = attendance
	}
	summary.Success = len(attendance) > 0
	summary.Rows = len(attendance)
	if required["attendance"] && !summary.Success {
		summary.Error = "attendance table parsed but contained no data rows"
		return summary, fmt.Errorf("%s", summary.Error)
	}
	if required["studentinfo"] && len(p.resp.Data.StudentInfo) == 0 {
		return summary, fmt.Errorf("student info could not be parsed from attendance bundle")
	}
	if required["marks"] && len(p.resp.Data.Marks) == 0 {
		return summary, fmt.Errorf("marks could not be parsed from attendance bundle")
	}
	return summary, nil
}

func (p *probe) fetchTimetableBundle() error {
	decoded, _, err := p.fetchDecodedFragment(
		"personal_timetable",
		defaultPersonalTTURL,
		p.serviceURL+"/#Page:My_Time_Table_2023_24",
	)
	if err != nil {
		return err
	}

	batch, rawCourses, advisors, err := parsePersonalTimetableHTML(decoded)
	if err != nil {
		return err
	}

	unifiedURL := defaultUnifiedTTB1
	unifiedName := "unified_timetable_batch_1"
	unifiedReferer := p.serviceURL + "/#Page:Unified_Time_Table_2025_Batch_1"
	if strings.TrimSpace(batch) == "2" {
		unifiedURL = defaultUnifiedTTB2
		unifiedName = "unified_timetable_batch_2"
		unifiedReferer = p.serviceURL + "/#Page:Unified_Time_Table_2025_batch_2"
	}

	unifiedHTML, _, err := p.fetchDecodedFragment(unifiedName, unifiedURL, unifiedReferer)
	if err != nil {
		return err
	}

	slotMap, err := parseBatchSlotMapHTML(unifiedHTML)
	if err != nil {
		return err
	}

	courses := mergeTimetableCourses(rawCourses, slotMap)
	p.resp.Data.Timetable = &TimetableResult{
		Batch:    batch,
		Courses:  courses,
		Advisors: advisors,
	}
	return nil
}

func (p *probe) fetchCalendars(targetSems []string) error {
	calendarResults := map[string]CalendarResult{}
	calendarTargets := []struct {
		sem     string
		url     string
		referer string
		name    string
	}{
		{
			sem:     "odd",
			url:     defaultCalendarOdd,
			referer: p.serviceURL + "/#Page:Academic_Planner_2025_26_ODD",
			name:    "calendar_odd",
		},
		{
			sem:     "even",
			url:     defaultCalendarEven,
			referer: p.serviceURL + "/#Page:Academic_Planner_2025_26_EVEN",
			name:    "calendar_even",
		},
	}

	for _, target := range calendarTargets {
		if len(targetSems) > 0 && !containsString(targetSems, target.sem) {
			continue
		}
		decoded, _, err := p.fetchDecodedFragment(target.name, target.url, target.referer)
		if err != nil {
			p.recordSectionError("calendar_"+target.sem, err)
			continue
		}

		calendar, err := parseAcademicCalendarHTML(decoded, target.sem)
		if err != nil {
			p.recordSectionError("calendar_"+target.sem, err)
			continue
		}

		calendarResults[target.sem] = calendar
	}

	if len(calendarResults) > 0 {
		p.resp.Data.Calendars = calendarResults
	}
	return nil
}

type decodedFragmentDebug struct {
	statusCode    int
	contentType   string
	payloadFound  bool
	payloadLength int
}

func (p *probe) fetchDecodedFragment(name, rawURL, referer string) (string, decodedFragmentDebug, error) {
	debug := decodedFragmentDebug{}
	snap, err := p.doRequest(name, http.MethodGet, rawURL, nil, "", map[string]string{
		"Accept":           "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"X-Requested-With": "XMLHttpRequest",
		"Referer":          referer,
	}, false)
	if err != nil {
		return "", debug, fmt.Errorf("%s request failed: %w", name, err)
	}

	debug.statusCode = snap.statusCode
	debug.contentType = snap.headers.Get("Content-Type")
	if snap.statusCode < 200 || snap.statusCode > 299 {
		return "", debug, fmt.Errorf("%s request returned %d", name, snap.statusCode)
	}

	body := string(snap.body)
	p.noteAuthenticatedEvidence(snap.url, body)

	decoded, payload, decodeErr := decodeSanitizedHTML(body)
	if decodeErr == nil {
		debug.payloadFound = payload != ""
		debug.payloadLength = len(payload)
		p.noteAuthenticatedEvidence(snap.url, decoded)
		return decoded, debug, nil
	}

	decoded, payload, zmlErr := decodeZMLValueHTML(body)
	if zmlErr == nil {
		debug.payloadFound = payload != ""
		debug.payloadLength = len(payload)
		p.noteAuthenticatedEvidence(snap.url, decoded)
		return decoded, debug, nil
	}

	if strings.Contains(strings.ToLower(body), "<table") || strings.Contains(strings.ToLower(body), "<html") {
		return body, debug, nil
	}

	return "", debug, fmt.Errorf("%v; %v", decodeErr, zmlErr)
}

func (p *probe) recordSectionError(section string, err error) {
	if err == nil {
		return
	}
	if p.resp.Data.Errors == nil {
		p.resp.Data.Errors = map[string]string{}
	}
	p.resp.Data.Errors[section] = err.Error()
}

func (p *probe) doRequest(name, method, rawURL string, body []byte, contentType string, extraHeaders map[string]string, followRedirects bool) (requestSnapshot, error) {
	currentURL := rawURL
	currentMethod := method
	currentBody := append([]byte(nil), body...)

	for redirects := 0; redirects < 10; redirects++ {
		var reader io.Reader
		if len(currentBody) > 0 {
			reader = bytes.NewReader(currentBody)
		}

		req, err := http.NewRequest(currentMethod, currentURL, reader)
		if err != nil {
			return requestSnapshot{}, err
		}

		req.Header.Set("User-Agent", p.userAgent)
		req.Header.Set("Referer", p.signinURL)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if token := p.csrfHeaderValue(); token != "" {
			req.Header.Set("X-ZCSRF-TOKEN", token)
		}
		for key, value := range extraHeaders {
			req.Header.Set(key, value)
		}

		resp, err := p.client.Do(req)
		if err != nil {
			return requestSnapshot{}, err
		}

		data, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return requestSnapshot{}, readErr
		}

		snap := requestSnapshot{
			name:       name,
			method:     currentMethod,
			url:        currentURL,
			statusCode: resp.StatusCode,
			location:   resp.Header.Get("Location"),
			body:       data,
			headers:    resp.Header.Clone(),
		}
		p.resp.RedirectSummary = append(p.resp.RedirectSummary, RequestTrace{
			Name:        name,
			Method:      currentMethod,
			URL:         currentURL,
			StatusCode:  resp.StatusCode,
			Location:    snap.location,
			ContentType: resp.Header.Get("Content-Type"),
			BodyLength:  len(data),
		})

		if followRedirects && isRedirectStatus(resp.StatusCode) && snap.location != "" {
			nextURL, err := resolveURL(currentURL, snap.location)
			if err != nil {
				return snap, err
			}
			if shouldSwitchToGet(resp.StatusCode, currentMethod) {
				currentMethod = http.MethodGet
				currentBody = nil
				contentType = ""
			}
			currentURL = nextURL
			continue
		}

		snap.url = currentURL
		return snap, nil
	}

	return requestSnapshot{}, fmt.Errorf("too many redirects for %s", rawURL)
}

func (p *probe) csrfHeaderValue() string {
	cookies := p.jar.Cookies(p.baseURL)
	for _, cookie := range cookies {
		if cookie.Name == p.csrfCookieName && cookie.Value != "" {
			return p.csrfParam + "=" + cookie.Value
		}
	}
	return ""
}

func (p *probe) cookieNames() []string {
	cookies := p.jar.Cookies(p.baseURL)
	names := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		names = append(names, cookie.Name)
	}
	sort.Strings(names)
	return names
}

func parseSigninPage(rawHTML []byte, finalURL, fallbackServiceURL string) (SigninPageInfo, error) {
	info := SigninPageInfo{
		FinalURL:        finalURL,
		ServiceURL:      fallbackServiceURL,
		CSRFParam:       extractJSQuotedValue(string(rawHTML), "csrfParam"),
		CSRFCookieName:  extractJSQuotedValue(string(rawHTML), "csrfCookieName"),
		URIPathPrefix:   extractJSQuotedValue(string(rawHTML), "uriPrefix"),
		EmailOnlySignin: extractJSBooleanValue(string(rawHTML), "emailOnlySignin"),
	}

	if info.ServiceURL == "" {
		info.ServiceURL = extractServiceURL(string(rawHTML), finalURL)
	}

	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(rawHTML))
	if err != nil {
		return info, err
	}

	doc.Find(`input[type="hidden"]`).Each(func(_ int, sel *goquery.Selection) {
		name, ok := sel.Attr("name")
		if !ok || strings.TrimSpace(name) == "" {
			return
		}
		value, _ := sel.Attr("value")
		info.HiddenFields = append(info.HiddenFields, HiddenField{
			Name:  strings.TrimSpace(name),
			Value: value,
		})
	})

	return info, nil
}

func parseLookupResponse(body []byte) lookupResult {
	result := lookupResult{}
	payload := parseJSONMap(body)
	if payload == nil {
		return result
	}

	result.summary.Code = getString(payload, "code")
	result.summary.ResourceName = getString(payload, "resource_name")
	result.summary.LocalizedMessage = getString(payload, "localized_message")
	result.summary.ErrorCode = firstErrorCode(payload)

	resource := nestedMap(payload, result.summary.ResourceName)
	if resource == nil {
		resource = nestedMap(payload, "lookup")
	}
	if resource == nil {
		return result
	}

	result.identifier = getString(resource, "identifier")
	result.digest = getString(resource, "digest")
	result.summary.Identifier = result.identifier
	if modes := nestedMap(resource, "modes"); modes != nil {
		result.summary.AllowedModes = getStringSlice(modes["allowed_modes"])
	}
	return result
}

func parsePasswordResponse(body []byte, location string) passwordResult {
	result := passwordResult{}
	payload := parseJSONMap(body)
	if payload == nil {
		return result
	}

	result.summary.Code = getString(payload, "code")
	result.summary.ResourceName = getString(payload, "resource_name")
	result.summary.LocalizedMessage = getString(payload, "localized_message")
	result.summary.ErrorCode = firstErrorCode(payload)

	resource := nestedMap(payload, result.summary.ResourceName)
	if resource != nil {
		result.summary.RedirectURI = getString(resource, "redirect_uri")
		result.summary.Status = getString(resource, "status")
		result.redirectURI = result.summary.RedirectURI
	}

	if result.redirectURI == "" {
		result.redirectURI = location
	}
	return result
}

func classifyPage(pageURL, body string) (string, string) {
	lowerURL := strings.ToLower(pageURL)
	lowerBody := strings.ToLower(body)

	switch {
	case strings.Contains(lowerURL, "sessions-reminder"),
		strings.Contains(lowerURL, "block-sessions"),
		strings.Contains(lowerURL, "preannouncement/block-sessions"),
		strings.Contains(lowerURL, "announcement/sessions-reminder"):
		return classSessions, "session reminder / active sessions page detected"
	case strings.Contains(lowerBody, "daily sign-in limit"),
		(strings.Contains(lowerBody, "signed in") && strings.Contains(lowerBody, "times today")),
		strings.Contains(lowerBody, "you are nearing your daily sign-in limit"),
		(strings.Contains(lowerURL, "signin-block") && strings.Contains(lowerBody, "i understand")):
		return classDailyLimit, "daily sign-in warning detected"
	default:
		return classUnknown, ""
	}
}

func classifyFromMessage(message, errorCode string) string {
	lowerMessage := strings.ToLower(message)
	switch {
	case strings.Contains(lowerMessage, "incorrect password"),
		strings.Contains(lowerMessage, "invalid password"),
		strings.Contains(lowerMessage, "verify your email address"),
		errorCode == "U401":
		return classInvalidCreds
	case strings.Contains(lowerMessage, "captcha"),
		errorCode == "IN107",
		errorCode == "IN108":
		return classCaptcha
	case strings.Contains(lowerMessage, "throttle"),
		strings.Contains(lowerMessage, "too many"),
		strings.Contains(lowerMessage, "temporarily blocked"):
		return classJSDependent
	default:
		return classUnknown
	}
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

func decodeZMLValueHTML(raw string) (decoded string, payload string, err error) {
	doc, parseErr := goquery.NewDocumentFromReader(strings.NewReader(raw))
	if parseErr != nil {
		return "", "", fmt.Errorf("could not parse zmlvalue HTML: %w", parseErr)
	}

	var found string
	doc.Find("[zmlvalue]").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		value, ok := sel.Attr("zmlvalue")
		if ok && strings.TrimSpace(value) != "" {
			found = value
			return false
		}
		return true
	})

	if found == "" {
		return "", "", fmt.Errorf("zmlvalue payload marker not found")
	}

	decoded = stdhtml.UnescapeString(found)
	if !strings.Contains(strings.ToLower(decoded), "<table") {
		return "", found, fmt.Errorf("zmlvalue payload did not decode into table HTML")
	}
	return decoded, found, nil
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
			b.WriteByte(parseHexByte(s[i+1 : i+3]))
			i += 2
		case 'u':
			if i+4 >= len(s) {
				return "", fmt.Errorf("short unicode escape")
			}
			b.WriteRune(parseHexRune(s[i+1 : i+5]))
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

func parseAttendance(decodedHTML string) ([]map[string]string, []string, error) {
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
		if containsString(rowHeaders, "Attn %") {
			table = sel
			headers = rowHeaders
			return false
		}
		return true
	})

	if table == nil {
		return nil, nil, fmt.Errorf("attendance table not found in decoded HTML")
	}

	var records []map[string]string
	table.Find("tr").Each(func(index int, row *goquery.Selection) {
		if index == 0 {
			return
		}
		cells := extractCells(row)
		if len(cells) == 0 || strings.TrimSpace(cells[0]) == "" {
			return
		}
		record := make(map[string]string, len(headers))
		for i, header := range headers {
			if i < len(cells) {
				record[header] = cells[i]
			} else {
				record[header] = ""
			}
		}
		records = append(records, record)
	})

	if len(records) == 0 {
		return nil, headers, fmt.Errorf("attendance table parsed but contained no data rows")
	}

	return records, headers, nil
}

func mapAttendanceRows(rows []map[string]string) []AttendanceRecord {
	result := make([]AttendanceRecord, 0, len(rows))
	for _, row := range rows {
		courseCode := strings.TrimSpace(row["Course Code"])
		if newline := strings.Index(courseCode, "\n"); newline >= 0 {
			courseCode = strings.TrimSpace(courseCode[:newline])
		}
		result = append(result, AttendanceRecord{
			CourseCode:     courseCode,
			CourseTitle:    strings.TrimSpace(row["Course Title"]),
			Category:       strings.TrimSpace(row["Category"]),
			FacultyName:    strings.TrimSpace(row["Faculty Name"]),
			Slot:           strings.TrimSpace(row["Slot"]),
			RoomNo:         strings.TrimSpace(row["Room No"]),
			HoursConducted: strings.TrimSpace(row["Hours Conducted"]),
			HoursAbsent:    strings.TrimSpace(row["Hours Absent"]),
			AttendancePct:  strings.TrimSpace(row["Attn %"]),
		})
	}
	return result
}

func parseStudentInfoHTML(decodedHTML string) (map[string]string, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return nil, fmt.Errorf("could not parse student info HTML: %w", err)
	}

	var table *goquery.Selection
	doc.Find("table").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		headers := extractHeaders(sel)
		if containsString(headers, "Registration Number:") {
			table = sel
			return false
		}
		return true
	})

	if table == nil {
		return nil, fmt.Errorf("student info table not found")
	}

	info := map[string]string{}
	table.Find("tr").Each(func(_ int, row *goquery.Selection) {
		cells := extractCells(row)
		for i := 0; i < len(cells); i++ {
			key := strings.TrimSpace(cells[i])
			if key == "" || key == ":" {
				continue
			}

			key = strings.TrimSpace(strings.TrimSuffix(key, ":"))
			if key == "" {
				continue
			}

			valueIndex := i + 1
			for valueIndex < len(cells) && strings.TrimSpace(cells[valueIndex]) == "" {
				valueIndex++
			}
			if valueIndex < len(cells) && strings.TrimSpace(cells[valueIndex]) == ":" {
				valueIndex++
			}
			for valueIndex < len(cells) && strings.TrimSpace(cells[valueIndex]) == "" {
				valueIndex++
			}
			if valueIndex >= len(cells) {
				continue
			}

			value := strings.TrimSpace(cells[valueIndex])
			if value != "" && value != ":" {
				info[key] = value
			}
		}
	})

	if len(info) == 0 {
		return nil, fmt.Errorf("student info table parsed but contained no data")
	}
	return info, nil
}

// isZohoPreviewURL returns true when u is a Zoho previewengine / Creator image URL
// that cannot be downloaded without session cookies scoped to zoho.com.
func isZohoPreviewURL(url string) bool {
	lowerURL := strings.ToLower(url)
	if strings.Contains(lowerURL, "previewengine") || (strings.Contains(lowerURL, "zoho.com") && strings.Contains(lowerURL, "/image/")) {
		return true
	}
	if strings.Contains(lowerURL, "academia.srmist.edu.in") && strings.Contains(lowerURL, "download-file?filepath=") {
		return true
	}
	return false
}
func extractStudentPhotoSource(decodedHTML string) (string, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return "", fmt.Errorf("could not parse student photo HTML: %w", err)
	}

	var src string

	// Pass 1: known Zoho Creator field selectors
	doc.Find(`img[src*="Photo_Upload_Student_Report"], img[src*="Your_Photo/image/"]`).EachWithBreak(func(_ int, img *goquery.Selection) bool {
		value, ok := img.Attr("src")
		if ok && strings.TrimSpace(value) != "" {
			src = strings.TrimSpace(value)
			return false
		}
		return true
	})
	if src != "" {
		return src, nil
	}

	// Pass 2: photo-id cell heuristic
	doc.Find("td").EachWithBreak(func(_ int, cell *goquery.Selection) bool {
		if !strings.Contains(strings.ToLower(extractCellText(cell)), "photo-id") {
			return true
		}
		row := cell.Parent()
		row.Find("img[src]").EachWithBreak(func(_ int, img *goquery.Selection) bool {
			value, ok := img.Attr("src")
			if ok && strings.TrimSpace(value) != "" {
				src = strings.TrimSpace(value)
				return false
			}
			return true
		})
		return src == ""
	})
	if src != "" {
		return src, nil
	}

	// Pass 3: any <img> whose src is a Zoho previewengine URL
	doc.Find("img[src]").EachWithBreak(func(_ int, img *goquery.Selection) bool {
		value, ok := img.Attr("src")
		if ok && isZohoPreviewURL(value) {
			src = strings.TrimSpace(value)
			return false
		}
		return true
	})

	if src == "" {
		return "", fmt.Errorf("student photo source not found")
	}
	return src, nil
}

func extractStudentPhotoDownloadURL(decodedHTML string) (string, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return "", fmt.Errorf("could not parse student photo download HTML: %w", err)
	}

	var candidate string
	doc.Find(`img[src*="Photo_Upload_Student_Report"], img[src*="Your_Photo/image/"]`).EachWithBreak(func(_ int, img *goquery.Selection) bool {
		for _, attr := range []string{"src", "downqual", "medqual", "lowqual"} {
			value, ok := img.Attr(attr)
			if !ok {
				continue
			}
			value = strings.TrimSpace(value)
			if value == "" || !strings.Contains(value, "/image/") {
				continue
			}
			candidate = value
			return false
		}
		return candidate == ""
	})

	// Pass 2: match any image whose src is a Zoho previewengine URL directly
	if candidate == "" {
		doc.Find("img[src]").EachWithBreak(func(_ int, img *goquery.Selection) bool {
			for _, attr := range []string{"src", "downqual", "medqual", "lowqual"} {
				value, ok := img.Attr(attr)
				if ok && isZohoPreviewURL(value) {
					candidate = strings.TrimSpace(value)
					return false
				}
			}
			return candidate == ""
		})
	}

	if candidate == "" {
		return "", fmt.Errorf("student photo download candidate not found")
	}

	// Zoho previewengine URLs are served from a different domain and require
	// Zoho-scoped cookies — return the raw URL so the backend can proxy it.
	if isZohoPreviewURL(candidate) {
		return candidate, nil
	}

	filepath := candidate[strings.LastIndex(candidate, "/image/")+len("/image/"):]
	filepath = strings.TrimSpace(filepath)
	if filepath == "" {
		return "", fmt.Errorf("student photo filepath could not be derived")
	}

	return defaultBaseURL +
		"/srm_university/academia-academic-services/report/Student_Profile_Report/" +
		defaultStudentPhotoReportID +
		"/Your_Photo/download-file?filepath=/" + url.QueryEscape(filepath) +
		"&digestValue=e30=", nil
}

func (p *probe) fetchStudentPhotoDataURL(photoSrc string) (string, error) {
	snap, err := p.doRequest("student_photo", http.MethodGet, photoSrc, nil, "", map[string]string{
		"Accept":  "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
		"Referer": p.serviceURL + "/#Report:Student_Profile_Report",
	}, true)
	if err != nil {
		return "", fmt.Errorf("student photo request failed: %w", err)
	}
	if snap.statusCode < 200 || snap.statusCode > 299 {
		return "", fmt.Errorf("student photo request returned %d", snap.statusCode)
	}
	if len(snap.body) == 0 {
		return "", fmt.Errorf("student photo response was empty")
	}

	contentType := strings.TrimSpace(snap.headers.Get("Content-Type"))
	if contentType == "" {
		contentType = guessImageContentType(photoSrc)
	}
	lowerContentType := strings.ToLower(contentType)
	if strings.Contains(lowerContentType, "application/octet-stream") {
		contentType = guessImageContentType(photoSrc)
		lowerContentType = strings.ToLower(contentType)
	}
	if !strings.HasPrefix(lowerContentType, "image/") {
		return "", fmt.Errorf("student photo response was not an image (%s)", contentType)
	}

	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(snap.body), nil
}

func guessImageContentType(rawURL string) string {
	lower := strings.ToLower(rawURL)
	switch {
	case strings.Contains(lower, ".png"):
		return "image/png"
	case strings.Contains(lower, ".webp"):
		return "image/webp"
	case strings.Contains(lower, ".gif"):
		return "image/gif"
	default:
		return "image/jpeg"
	}
}

func parseMarksHTML(decodedHTML string) ([]MarkRecord, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return nil, fmt.Errorf("could not parse marks HTML: %w", err)
	}

	var table *goquery.Selection
	doc.Find("table").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		headers := extractHeaders(sel)
		if containsString(headers, "Test Performance") {
			table = sel
			return false
		}
		return true
	})

	if table == nil {
		return nil, fmt.Errorf("marks table not found")
	}

	var result []MarkRecord
	rows := extractDirectRows(table)
	for index, row := range rows {
		if index == 0 {
			continue
		}

		cells := extractDirectCells(row)
		if len(cells) < 2 || strings.TrimSpace(extractCellText(cells[0])) == "" {
			continue
		}

		record := MarkRecord{
			CourseCode: strings.TrimSpace(extractCellText(cells[0])),
			CourseType: strings.TrimSpace(extractCellText(cells[1])),
			Tests:      []MarkTest{},
		}

		if len(cells) >= 3 {
			cells[2].Find("td").Each(func(_ int, inner *goquery.Selection) {
				test := parseMarkTestCell(inner)
				if test.TestName != "" || test.Score != "" || test.MaxScore != "" {
					record.Tests = append(record.Tests, test)
				}
			})
		}

		result = append(result, record)
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("marks table parsed but contained no data rows")
	}
	return result, nil
}

func parseMarkTestCell(cell *goquery.Selection) MarkTest {
	lines := splitNonEmpty(extractCellText(cell), regexpMustCompile(`[\n\t]+`))
	if len(lines) == 0 {
		return MarkTest{}
	}

	spec := strings.TrimSpace(lines[0])
	score := ""
	if len(lines) > 1 {
		score = strings.TrimSpace(strings.Join(lines[1:], " "))
	}

	test := MarkTest{
		TestName: spec,
		Score:    score,
	}
	if slash := strings.LastIndex(spec, "/"); slash >= 0 {
		test.TestName = strings.TrimSpace(spec[:slash])
		test.MaxScore = strings.TrimSpace(spec[slash+1:])
	}
	return test
}

func parsePersonalTimetableHTML(decodedHTML string) (string, []map[string]string, []Advisor, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return "", nil, nil, fmt.Errorf("could not parse timetable HTML: %w", err)
	}

	batch := "1"
	info, err := parseStudentInfoHTML(decodedHTML)
	if err == nil {
		if parsedBatch := strings.TrimSpace(info["Batch"]); parsedBatch != "" {
			batch = parsedBatch
		}
	}

	var advisorTable *goquery.Selection
	var courseTable *goquery.Selection
	doc.Find("table").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		headers := extractHeaders(sel)
		if advisorTable == nil && containsString(headers, "Counselor") {
			advisorTable = sel
		}
		if courseTable == nil && containsString(headers, "Course Code") && containsString(headers, "Slot") {
			courseTable = sel
		}
		return advisorTable == nil || courseTable == nil
	})

	var advisors []Advisor
	if advisorTable != nil {
		firstRow := advisorTable.Find("tr").First()
		cells := extractCells(firstRow)
		for i := 2; i < len(cells); i++ {
			lines := splitNonEmpty(cells[i], regexpMustCompile(`\n+`))
			if len(lines) == 0 {
				continue
			}
			advisors = append(advisors, Advisor{
				Name:  valueAt(lines, 0),
				Role:  valueAt(lines, 1),
				Email: valueAt(lines, 2),
				Phone: valueAt(lines, 3),
			})
		}
	}

	if courseTable == nil {
		return batch, nil, advisors, fmt.Errorf("personal timetable course table not found")
	}

	headers := extractHeaders(courseTable)
	var courses []map[string]string
	courseTable.Find("tr").Each(func(index int, row *goquery.Selection) {
		if index == 0 {
			return
		}
		cells := extractCells(row)
		if len(cells) < 2 || strings.TrimSpace(cells[1]) == "" {
			return
		}
		record := map[string]string{}
		for i, header := range headers {
			if i < len(cells) {
				record[header] = strings.TrimSpace(cells[i])
			} else {
				record[header] = ""
			}
		}
		courses = append(courses, record)
	})

	if len(courses) == 0 {
		return batch, nil, advisors, fmt.Errorf("personal timetable parsed but contained no courses")
	}
	return batch, courses, advisors, nil
}

func parseBatchSlotMapHTML(decodedHTML string) (map[string][]ScheduleEntry, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return nil, fmt.Errorf("could not parse unified timetable HTML: %w", err)
	}

	var table *goquery.Selection
	doc.Find("table").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		rows := extractTableMatrix(sel)
		if len(rows) > 0 && len(rows[0]) > 0 && strings.TrimSpace(rows[0][0]) == "FROM" {
			table = sel
			return false
		}
		return true
	})

	if table == nil {
		return nil, fmt.Errorf("unified timetable grid not found")
	}

	rows := extractTableMatrix(table)
	if len(rows) == 0 || len(rows[0]) < 2 {
		return nil, fmt.Errorf("unified timetable grid was empty")
	}

	timings := rows[0][1:]
	slotMap := map[string][]ScheduleEntry{}
	for _, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}

		day := strings.TrimSpace(row[0])
		if !strings.HasPrefix(day, "Day") {
			continue
		}

		for col := 1; col < len(row) && col-1 < len(timings); col++ {
			cellText := strings.TrimSpace(row[col])
			if cellText == "" {
				continue
			}
			timing := strings.TrimSpace(timings[col-1])
			tokens := splitSlotTokens(cellText)
			for _, token := range tokens {
				slotMap[token] = append(slotMap[token], ScheduleEntry{
					Day:       day,
					HourIndex: col,
					Timing:    timing,
					SlotToken: token,
				})
			}
		}
	}

	if len(slotMap) == 0 {
		return nil, fmt.Errorf("unified timetable grid parsed but contained no slot mappings")
	}
	return slotMap, nil
}

func mergeTimetableCourses(rawCourses []map[string]string, slotMap map[string][]ScheduleEntry) []TimetableCourse {
	courses := make([]TimetableCourse, 0, len(rawCourses))
	for _, course := range rawCourses {
		rawSlot := strings.TrimSpace(course["Slot"])
		var schedule []ScheduleEntry
		for _, token := range splitCourseSlotTokens(rawSlot) {
			for _, entry := range slotMap[token] {
				schedule = append(schedule, ScheduleEntry{
					Day:       entry.Day,
					HourIndex: entry.HourIndex,
					Timing:    entry.Timing,
					SlotToken: token,
				})
			}
		}
		sort.Slice(schedule, func(i, j int) bool {
			leftDay, rightDay := parseDayNumber(schedule[i].Day), parseDayNumber(schedule[j].Day)
			if leftDay != rightDay {
				return leftDay < rightDay
			}
			return schedule[i].HourIndex < schedule[j].HourIndex
		})

		courses = append(courses, TimetableCourse{
			CourseCode:  strings.TrimSpace(course["Course Code"]),
			CourseTitle: strings.TrimSpace(course["Course Title"]),
			Credit:      strings.TrimSpace(course["Credit"]),
			Category:    strings.TrimSpace(course["Category"]),
			CourseType:  strings.TrimSpace(course["Course Type"]),
			FacultyName: strings.TrimSpace(course["Faculty Name"]),
			Slot:        rawSlot,
			RoomNo:      strings.TrimSpace(course["Room No."]),
			Schedule:    schedule,
		})
	}
	return courses
}

func parseAcademicCalendarHTML(decodedHTML, sem string) (CalendarResult, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(decodedHTML))
	if err != nil {
		return CalendarResult{}, fmt.Errorf("could not parse calendar HTML: %w", err)
	}

	monthRe := regexpMustCompile(`^(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|Jun(e)?|Jul(y)?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\b`)
	bestScore := 0
	bestHeaderRow := 0
	var bestTable [][]string

	doc.Find("table").Each(func(_ int, sel *goquery.Selection) {
		rows := extractTableMatrix(sel)
		for rowIndex := 0; rowIndex < len(rows) && rowIndex < 5; rowIndex++ {
			hits := 0
			for _, cell := range rows[rowIndex] {
				if monthRe.MatchString(strings.TrimSpace(cell)) {
					hits++
				}
			}
			if hits > bestScore {
				bestScore = hits
				bestHeaderRow = rowIndex
				bestTable = rows
			}
		}
		if bestScore == 0 && len(rows) > len(bestTable) {
			bestTable = rows
			bestHeaderRow = 0
		}
	})

	if len(bestTable) == 0 {
		return CalendarResult{}, fmt.Errorf("calendar table not found")
	}

	headerCells := bestTable[bestHeaderRow]
	type monthGroup struct {
		name     string
		dtCol    int
		dayCol   int
		eventCol int
		doCol    int
	}

	var monthGroups []monthGroup
	for i, cell := range headerCells {
		if monthRe.MatchString(strings.TrimSpace(cell)) && i >= 2 {
			monthGroups = append(monthGroups, monthGroup{
				name:     strings.TrimSpace(cell),
				dtCol:    i - 2,
				dayCol:   i - 1,
				eventCol: i,
				doCol:    i + 1,
			})
		}
	}

	if len(monthGroups) == 0 && len(headerCells) >= 4 {
		for i := 0; i+3 < len(headerCells); i += 5 {
			name := fmt.Sprintf("Month%d", len(monthGroups)+1)
			for _, cell := range headerCells[i:minInt(i+5, len(headerCells))] {
				if monthRe.MatchString(strings.TrimSpace(cell)) {
					name = strings.TrimSpace(cell)
					break
				}
			}
			monthGroups = append(monthGroups, monthGroup{
				name:     name,
				dtCol:    i,
				dayCol:   i + 1,
				eventCol: i + 2,
				doCol:    i + 3,
			})
		}
	}

	var months []CalendarMonth
	for _, group := range monthGroups {
		var days []CalendarDay
		for rowIndex := bestHeaderRow + 1; rowIndex < len(bestTable); rowIndex++ {
			row := bestTable[rowIndex]
			date := valueAt(row, group.dtCol)
			if strings.TrimSpace(date) == "" {
				continue
			}
			days = append(days, CalendarDay{
				Date:     strings.TrimSpace(date),
				Day:      strings.TrimSpace(valueAt(row, group.dayCol)),
				Event:    strings.TrimSpace(valueAt(row, group.eventCol)),
				DayOrder: strings.TrimSpace(valueAt(row, group.doCol)),
			})
		}
		months = append(months, CalendarMonth{
			Name: strings.TrimSpace(group.name),
			Days: days,
		})
	}

	title := ""
	for _, selector := range []string{"h1", "h2", "h3", ".page-title", `[class*="title"]`} {
		doc.Find(selector).EachWithBreak(func(_ int, sel *goquery.Selection) bool {
			text := strings.TrimSpace(extractCellText(sel))
			if text != "" && len(text) > 3 && len(text) < 200 {
				title = text
				return false
			}
			return true
		})
		if title != "" {
			break
		}
	}

	if len(months) == 0 {
		return CalendarResult{}, fmt.Errorf("calendar parsed but contained no month groups")
	}
	return CalendarResult{
		Sem:    sem,
		Title:  title,
		Months: months,
	}, nil
}

func extractTableMatrix(table *goquery.Selection) [][]string {
	var rows [][]string
	table.Find("tr").Each(func(_ int, row *goquery.Selection) {
		rows = append(rows, extractCells(row))
	})
	return rows
}

func splitNonEmpty(raw string, separator *regexp.Regexp) []string {
	parts := separator.Split(raw, -1)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func splitSlotTokens(raw string) []string {
	parts := regexpMustCompile(`\s*/\s*|\n+`).Split(raw, -1)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func splitCourseSlotTokens(raw string) []string {
	parts := strings.Split(raw, "-")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseDayNumber(day string) int {
	matches := regexpMustCompile(`(\d+)`).FindStringSubmatch(day)
	if len(matches) < 2 {
		return 999
	}
	var value int
	for i := 0; i < len(matches[1]); i++ {
		value = (value * 10) + int(matches[1][i]-'0')
	}
	return value
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func valueAt[T ~[]E, E any](items T, index int) E {
	var zero E
	if index < 0 || index >= len(items) {
		return zero
	}
	return items[index]
}

func extractHeaders(table *goquery.Selection) []string {
	return extractCells(table.Find("tr").First())
}

func extractDirectRows(table *goquery.Selection) []*goquery.Selection {
	var rows []*goquery.Selection
	containers := table.ChildrenFiltered("tbody")
	if containers.Length() == 0 {
		containers = table
	}
	containers.Each(func(_ int, container *goquery.Selection) {
		container.ChildrenFiltered("tr").Each(func(_ int, row *goquery.Selection) {
			rows = append(rows, row)
		})
	})
	return rows
}

func extractDirectCells(row *goquery.Selection) []*goquery.Selection {
	var cells []*goquery.Selection
	row.ChildrenFiltered("th,td").Each(func(_ int, cell *goquery.Selection) {
		cells = append(cells, cell)
	})
	return cells
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

	lines := strings.Split(b.String(), "\n")
	for i, line := range lines {
		lines[i] = strings.Join(strings.Fields(line), " ")
	}

	text := strings.TrimSpace(strings.Join(lines, "\n"))
	for strings.Contains(text, "\n\n") {
		text = strings.ReplaceAll(text, "\n\n", "\n")
	}
	return text
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
	return tag == "br" || tag == "hr"
}

func isBlockNode(tag string) bool {
	switch tag {
	case "div", "p", "section", "article", "header", "footer", "li", "tr", "table":
		return true
	default:
		return false
	}
}

func extractJSQuotedValue(raw, name string) string {
	patterns := []string{
		`var ` + name + `\s*=\s*"([^"]*)"`,
		`var ` + name + `\s*=\s*'([^']*)'`,
	}
	for _, pattern := range patterns {
		if value := firstRegexGroup(raw, pattern); value != "" {
			return unescapeJSLiteral(value)
		}
	}
	return ""
}

func extractJSBooleanValue(raw, name string) bool {
	value := firstRegexGroup(raw, `var `+name+`\s*=\s*Boolean\("([^"]*)"\)`)
	return strings.EqualFold(value, "true")
}

func extractServiceURL(raw, fallbackURL string) string {
	if value := firstRegexGroup(raw, `serviceUrl\s*=\s*'([^']+)'`); value != "" {
		return unescapeJSLiteral(value)
	}
	parsed, err := url.Parse(fallbackURL)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("serviceurl")
}

func extractSessionContinueURL(rawHTML, currentURL string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err == nil {
		selectors := []string{
			`#continue_button[href]`,
			`.continue_button[href]`,
			`a[href*="/next?status=2"]`,
			`a[href*="status=2"]`,
			`button[href*="status=2"]`,
		}
		for _, selector := range selectors {
			href, ok := doc.Find(selector).First().Attr("href")
			if ok && strings.TrimSpace(href) != "" {
				if resolved, err := resolveURL(currentURL, href); err == nil {
					return resolved
				}
			}
		}
	}

	if href := firstRegexGroup(rawHTML, `href="([^"]*\/next\?status=2[^"]*)"`); href != "" {
		if resolved, err := resolveURL(currentURL, href); err == nil {
			return resolved
		}
	}

	return ""
}

func deriveSessionContinueURL(currentURL string) string {
	parsed, err := url.Parse(currentURL)
	if err != nil {
		return ""
	}

	if strings.Contains(parsed.Path, "/preannouncement/block-sessions") {
		derived := *parsed
		derived.Path = strings.TrimRight(parsed.Path, "/") + "/next"
		derived.RawQuery = ""
		return derived.String()
	}

	nextPath := strings.TrimRight(parsed.Path, "/") + "/next"
	query := parsed.Query()
	query.Set("status", "2")

	derived := *parsed
	derived.Path = nextPath
	derived.RawQuery = query.Encode()
	return derived.String()
}

func derivePreannouncementDeleteURL(currentURL string) string {
	parsed, err := url.Parse(currentURL)
	if err != nil {
		return ""
	}

	index := strings.Index(parsed.Path, "/preannouncement/block-sessions")
	if index < 0 {
		return ""
	}

	derived := *parsed
	derived.Path = strings.TrimRight(parsed.Path[:index], "/") + "/webclient/v1/announcement/pre/blocksessions"
	derived.RawQuery = ""
	return derived.String()
}

func extractContinuationActions(rawHTML, currentURL string) []sessionAction {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil
	}

	var actions []sessionAction
	seen := map[string]bool{}
	addAction := func(action sessionAction) {
		if strings.TrimSpace(action.url) == "" {
			return
		}
		if strings.TrimSpace(action.method) == "" {
			action.method = http.MethodGet
		}
		key := action.method + " " + action.url + " " + string(action.body)
		if seen[key] {
			return
		}
		seen[key] = true
		actions = append(actions, action)
	}

	doc.Find("a[href], button[href], [data-href]").Each(func(_ int, sel *goquery.Selection) {
		for _, attr := range []string{"href", "data-href"} {
			target, ok := sel.Attr(attr)
			if !ok {
				continue
			}
			if resolved, ok := resolveSessionActionURL(currentURL, target); ok {
				addAction(sessionAction{
					name:   "session_action_link",
					method: http.MethodGet,
					url:    resolved,
				})
			}
		}
	})

	doc.Find("form").Each(func(_ int, form *goquery.Selection) {
		actionURL, _ := form.Attr("action")
		if strings.TrimSpace(actionURL) == "" {
			actionURL = currentURL
		}
		resolved, ok := resolveSessionActionURL(currentURL, actionURL)
		if !ok {
			return
		}

		method := strings.ToUpper(strings.TrimSpace(attrOrDefault(form, "method", http.MethodGet)))
		values := url.Values{}
		form.Find("input,select,textarea").Each(func(_ int, field *goquery.Selection) {
			name, ok := field.Attr("name")
			if !ok || strings.TrimSpace(name) == "" {
				return
			}
			fieldType := strings.ToLower(strings.TrimSpace(attrOrDefault(field, "type", "")))
			if fieldType == "submit" || fieldType == "button" {
				return
			}
			value, _ := field.Attr("value")
			values.Add(name, value)
		})

		action := sessionAction{
			name:   "session_action_form",
			method: method,
			url:    resolved,
		}
		if method != http.MethodGet && len(values) > 0 {
			action.body = []byte(values.Encode())
			action.contentType = "application/x-www-form-urlencoded;charset=UTF-8"
		}
		addAction(action)
	})

	doc.Find("[onclick]").Each(func(_ int, sel *goquery.Selection) {
		onclick, _ := sel.Attr("onclick")
		for _, candidate := range extractJSURLCandidates(onclick) {
			if resolved, ok := resolveSessionActionURL(currentURL, candidate); ok {
				addAction(sessionAction{
					name:   "session_action_onclick",
					method: http.MethodGet,
					url:    resolved,
				})
			}
		}
	})

	return actions
}

func resolveSessionActionURL(currentURL, rawTarget string) (string, bool) {
	target := strings.TrimSpace(rawTarget)
	if target == "" {
		return "", false
	}
	target = strings.Trim(target, `"'`)
	lower := strings.ToLower(target)
	relevant := strings.Contains(lower, "block-sessions") ||
		strings.Contains(lower, "sessions-reminder") ||
		strings.Contains(lower, "signin-block") ||
		strings.Contains(lower, "terminate") ||
		strings.Contains(lower, "status=2") ||
		strings.Contains(lower, "continue") ||
		strings.Contains(lower, "understand")
	if !relevant {
		return "", false
	}
	resolved, err := resolveURL(currentURL, target)
	if err != nil {
		return "", false
	}
	return resolved, true
}

func extractJSURLCandidates(raw string) []string {
	patterns := []string{
		`location\.href\s*=\s*['"]([^'"]+)['"]`,
		`window\.location\s*=\s*['"]([^'"]+)['"]`,
		`window\.open\(\s*['"]([^'"]+)['"]`,
		`['"]([^'"]*(?:block-sessions|sessions-reminder|status=2|terminate|continue)[^'"]*)['"]`,
	}
	seen := map[string]bool{}
	var matches []string
	for _, pattern := range patterns {
		re := regexpMustCompile(pattern)
		for _, item := range re.FindAllStringSubmatch(raw, -1) {
			if len(item) < 2 {
				continue
			}
			candidate := strings.TrimSpace(item[1])
			if candidate == "" || seen[candidate] {
				continue
			}
			seen[candidate] = true
			matches = append(matches, candidate)
		}
	}
	return matches
}

func attrOrDefault(sel *goquery.Selection, name, fallback string) string {
	value, ok := sel.Attr(name)
	if !ok {
		return fallback
	}
	return value
}

func firstRegexGroup(raw, pattern string) string {
	re := regexpMustCompile(pattern)
	match := re.FindStringSubmatch(raw)
	if len(match) >= 2 {
		return match[1]
	}
	return ""
}

func regexpMustCompile(pattern string) *regexp.Regexp {
	if compiled, ok := regexpCache[pattern]; ok {
		return compiled
	}
	compiled := regexp.MustCompile(pattern)
	regexpCache[pattern] = compiled
	return compiled
}

func parseJSONMap(body []byte) map[string]any {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	return payload
}

func nestedMap(payload map[string]any, key string) map[string]any {
	if key == "" {
		return nil
	}
	value, ok := payload[key]
	if !ok {
		return nil
	}
	typed, _ := value.(map[string]any)
	return typed
}

func getString(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func getStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text := strings.TrimSpace(fmt.Sprintf("%v", item))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func firstErrorCode(payload map[string]any) string {
	errors, ok := payload["errors"].([]any)
	if !ok || len(errors) == 0 {
		return ""
	}
	first, ok := errors[0].(map[string]any)
	if !ok {
		return ""
	}
	return getString(first, "code")
}

func resolveURL(baseURL, location string) (string, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	ref, err := url.Parse(location)
	if err != nil {
		return "", err
	}
	return base.ResolveReference(ref).String(), nil
}

func isRedirectStatus(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	default:
		return false
	}
}

func shouldSwitchToGet(status int, method string) bool {
	if status == http.StatusSeeOther {
		return true
	}
	return (status == http.StatusMovedPermanently || status == http.StatusFound) && method == http.MethodPost
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}

func unescapeJSLiteral(value string) string {
	value = strings.ReplaceAll(value, `\/`, `/`)
	value = strings.ReplaceAll(value, `\'`, `'`)
	value = strings.ReplaceAll(value, `\"`, `"`)
	return value
}

func parseHexByte(raw string) byte {
	var value byte
	for i := 0; i < len(raw); i++ {
		value *= 16
		value += hexNibble(raw[i])
	}
	return value
}

func parseHexRune(raw string) rune {
	var value rune
	for i := 0; i < len(raw); i++ {
		value *= 16
		value += rune(hexNibble(raw[i]))
	}
	return value
}

func hexNibble(ch byte) byte {
	switch {
	case ch >= '0' && ch <= '9':
		return ch - '0'
	case ch >= 'a' && ch <= 'f':
		return ch - 'a' + 10
	case ch >= 'A' && ch <= 'F':
		return ch - 'A' + 10
	default:
		return 0
	}
}

func strconvMillis(t time.Time) string {
	return fmt.Sprintf("%d", t.UnixMilli())
}

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func writeJSON(v ProbeResponse) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(v); err != nil {
		fmt.Fprintln(os.Stderr, "could not encode JSON:", err)
	}
}
