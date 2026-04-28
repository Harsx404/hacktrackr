package scraper

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocolly/colly/v2"
	"github.com/vivek2584/faculty-scraper/models"
)

var reFeaturedImage = regexp.MustCompile(`"featuredImage"\s*:\s*"(https:[^"]+\.(?:jpg|jpeg|png|webp))"`)

const (
	userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
	baseURL   = "https://www.srmist.edu.in"
)

// ScrapeProfile fetches a single faculty profile by slug.
// slug example: "dr-ganapathy-sankar-u"
func ScrapeProfile(slug string) (*models.Faculty, error) {
	profileURL := baseURL + "/faculty/" + slug + "/"
	var faculty *models.Faculty
	var scrapeErr error

	c := colly.NewCollector(
		colly.AllowedDomains("www.srmist.edu.in"),
	)
	c.SetRequestTimeout(10 * time.Second)

	c.OnRequest(func(r *colly.Request) {
		r.Headers.Set("User-Agent", userAgent)
	})

	c.OnError(func(r *colly.Response, err error) {
		scrapeErr = fmt.Errorf("failed to fetch %s: %w", r.Request.URL, err)
	})

	c.OnHTML("html", func(e *colly.HTMLElement) {
		f := parseProfile(e)
		if f.Name != "" {
			faculty = &f
		}
	})

	if err := c.Visit(profileURL); err != nil {
		return nil, fmt.Errorf("failed to visit %s: %w", profileURL, err)
	}
	c.Wait()

	if scrapeErr != nil {
		return nil, scrapeErr
	}
	if faculty == nil {
		return nil, fmt.Errorf("no faculty data found at %s", profileURL)
	}
	return faculty, nil
}

// parseProfile extracts Faculty data from a profile page's root HTML element.
func parseProfile(e *colly.HTMLElement) models.Faculty {
	f := models.Faculty{
		ProfileURL: e.Request.URL.String(),
	}

	// Name (from og:title meta tag — cleanest source)
	f.Name = e.ChildAttr("meta[property='og:title']", "content")
	f.Name = strings.TrimSuffix(f.Name, " - SRMIST")
	f.Name = strings.TrimSpace(f.Name)

	// Profile photo — extracted from WordPress JSON data embedded in a <script> block.
	// The actual <img> src is a lazy-load SVG placeholder; the real URL lives in
	// a JS variable as: "featuredImage":"https:\/\/www.srmist.edu.in\/wp-content\/..."
	e.ForEach("script", func(_ int, el *colly.HTMLElement) {
		if f.PhotoURL != "" {
			return
		}
		if m := reFeaturedImage.FindStringSubmatch(el.Text); len(m) > 1 {
			f.PhotoURL = strings.ReplaceAll(m[1], `\/`, `/`)
		}
	})

	// Info list items (designation, department, phone, email)
	var listItems []string
	e.ForEach("div.hide_empty_list_item .elementor-icon-list-items .elementor-icon-list-item .elementor-icon-list-text", func(i int, el *colly.HTMLElement) {
		text := strings.TrimSpace(el.Text)
		if text != "" {
			listItems = append(listItems, text)
		}
	})

	if len(listItems) >= 1 {
		f.Designation = listItems[0]
	}
	// Email is detected by @ rather than position — some pages omit department/phone
	for _, item := range listItems {
		if strings.Contains(item, "@") {
			f.Email = item
			break
		}
	}
	// Department is index 1 only if it is not an email address
	if len(listItems) >= 2 && !strings.Contains(listItems[1], "@") {
		f.Department = listItems[1]
	}

	// Campus / College info
	campusText := strings.TrimSpace(e.ChildText(".faculty-cdc"))
	campusText = strings.TrimPrefix(campusText, "CAMPUS:")
	campusText = strings.TrimSpace(campusText)
	campusText = strings.Join(strings.Fields(campusText), " ")
	f.Campus = campusText

	// Experience
	e.ForEach("div[data-widget_type='text-editor.default'] .elementor-widget-container", func(i int, el *colly.HTMLElement) {
		text := strings.TrimSpace(el.Text)
		if strings.HasPrefix(text, "EXPERIENCE") {
			exp := strings.TrimPrefix(text, "EXPERIENCE :")
			exp = strings.TrimPrefix(exp, "EXPERIENCE:")
			f.Experience = strings.TrimSpace(exp)
		}
	})

	// Research Interest
	e.ForEach("div[data-widget_type='text-editor.default'] .elementor-widget-container", func(i int, el *colly.HTMLElement) {
		text := strings.TrimSpace(el.Text)
		if strings.HasPrefix(text, "RESEARCH INTEREST") {
			ri := strings.TrimPrefix(text, "RESEARCH INTEREST :")
			ri = strings.TrimPrefix(ri, "RESEARCH INTEREST:")
			f.ResearchInterest = strings.TrimSpace(ri)
		}
	})

	// Courses
	e.ForEach("div[data-widget_type='text-editor.default'] .elementor-widget-container", func(i int, el *colly.HTMLElement) {
		text := strings.TrimSpace(el.Text)
		if strings.HasPrefix(text, "COURSES") {
			c := strings.TrimPrefix(text, "COURSES :")
			c = strings.TrimPrefix(c, "COURSES:")
			f.Courses = strings.TrimSpace(c)
		}
	})

	// ── Tab content ───────────────────────────────────────────────
	tabTitles := make(map[int]string)
	e.ForEach(".elementor-tab-title", func(i int, el *colly.HTMLElement) {
		tab := el.Attr("data-tab")
		if tab != "" {
			n, _ := strconv.Atoi(tab)
			title := strings.ToLower(strings.TrimSpace(el.Text))
			tabTitles[n] = title
		}
	})

	e.ForEach(".elementor-tab-content", func(i int, el *colly.HTMLElement) {
		tab := el.Attr("data-tab")
		if tab == "" {
			return
		}
		n, _ := strconv.Atoi(tab)
		title := tabTitles[n]
		content := cleanText(el.Text)
		if content == "" {
			return
		}

		switch {
		case strings.Contains(title, "education"):
			f.Education = content
		case strings.Contains(title, "publication"):
			f.Publications = content
		case strings.Contains(title, "award"):
			f.Awards = content
		case strings.Contains(title, "workshop") || strings.Contains(title, "seminar") || strings.Contains(title, "conference"):
			f.Workshops = content
		case strings.Contains(title, "work experience"):
			f.WorkExperience = content
		case strings.Contains(title, "membership"):
			f.Memberships = content
		case strings.Contains(title, "responsibilities") || strings.Contains(title, "responsibility"):
			f.Responsibilities = content
		}
	})

	return f
}

// SearchFaculty searches for faculty by name using SRM's WordPress search page.
// Returns a list of profile slugs (e.g., ["dr-ganapathy-sankar-u", "mr-ganapathy-s"]).
func SearchFaculty(name string) ([]string, error) {
	searchURL := fmt.Sprintf("%s/?s=%s&post_type=faculty", baseURL, strings.ReplaceAll(name, " ", "+"))
	var slugs []string
	var scrapeErr error

	c := colly.NewCollector(
		colly.AllowedDomains("www.srmist.edu.in"),
	)
	c.SetRequestTimeout(10 * time.Second)

	c.OnRequest(func(r *colly.Request) {
		r.Headers.Set("User-Agent", userAgent)
	})

	c.OnError(func(r *colly.Response, err error) {
		scrapeErr = fmt.Errorf("search request failed: %w", err)
	})

	// WordPress search results: each result links to /faculty/{slug}/
	c.OnHTML("article a[href]", func(e *colly.HTMLElement) {
		href := e.Attr("href")
		if strings.Contains(href, "/faculty/") {
			parts := strings.Split(strings.TrimRight(href, "/"), "/")
			if len(parts) > 0 {
				slug := parts[len(parts)-1]
				for _, existing := range slugs {
					if existing == slug {
						return
					}
				}
				slugs = append(slugs, slug)
			}
		}
	})

	if err := c.Visit(searchURL); err != nil {
		return nil, fmt.Errorf("failed to visit search page: %w", err)
	}
	c.Wait()

	if scrapeErr != nil {
		return nil, scrapeErr
	}
	return slugs, nil
}

// SearchAndScrape searches for faculty by name and scrapes ALL matching profiles in parallel.
func SearchAndScrape(name string) ([]*models.Faculty, error) {
	slugs, err := SearchFaculty(name)
	if err != nil {
		return nil, err
	}

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		profiles []*models.Faculty
	)
	for _, slug := range slugs {
		wg.Add(1)
		go func(s string) {
			defer wg.Done()
			f, err := ScrapeProfile(s)
			if err != nil {
				fmt.Printf("Warning: failed to scrape %s: %v\n", s, err)
				return
			}
			mu.Lock()
			profiles = append(profiles, f)
			mu.Unlock()
		}(slug)
	}
	wg.Wait()
	return profiles, nil
}

// cleanText collapses runs of whitespace into single spaces and trims.
func cleanText(s string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
}
