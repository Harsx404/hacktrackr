package models

// Faculty holds the scraped data for one faculty member.
type Faculty struct {
	Name             string `json:"name"`
	PhotoURL         string `json:"photo_url,omitempty"`
	Designation      string `json:"designation"`
	Department       string `json:"department"`
	Email            string `json:"email,omitempty"`
	Campus           string `json:"campus"`
	Experience       string `json:"experience,omitempty"`
	ResearchInterest string `json:"research_interest,omitempty"`
	Courses          string `json:"courses,omitempty"`
	Education        string `json:"education,omitempty"`
	Publications     string `json:"publications,omitempty"`
	Awards           string `json:"awards,omitempty"`
	Workshops        string `json:"workshops,omitempty"`
	WorkExperience   string `json:"work_experience,omitempty"`
	Memberships      string `json:"memberships,omitempty"`
	Responsibilities string `json:"responsibilities,omitempty"`
	ProfileURL       string `json:"profile_url"`
}


