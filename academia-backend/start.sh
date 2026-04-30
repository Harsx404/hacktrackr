#!/bin/sh
# Start faculty scraper on fixed internal port 8080
PORT=8080 ./faculty-scraper-bin &

# Start Node.js server — uses $PORT injected by Render
exec node server.js
