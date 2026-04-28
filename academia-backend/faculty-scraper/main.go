package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/vivek2584/faculty-scraper/api"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	addr := ":" + port
	fmt.Printf("Faculty API server starting on http://localhost%s\n", addr)
	fmt.Println()
	fmt.Println("Endpoints:")
	fmt.Println("  GET /api/faculty/{slug}   → faculty profile JSON")
	fmt.Println("  GET /api/slug?name=       → convert name to slug")
	fmt.Println("  GET /faculty/{slug}       → redirect to SRM profile page")
	fmt.Println()

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
