# Chronos AI Website

A professional static website for Chronos AI, hosted on GitHub Pages. The website showcases an independent AI assistant project focused on thoughtful conversations, local model support, and creative work.

## Features

- **AI Assistant**: Chat-based interface for exploring ideas, solving problems, and working through thoughts
- **Local Models**: Designed to support compatible local models on supported hardware for self-hosting
- **Professional Design**: Clean, modern interface built for focus and clarity
- **No Cost**: Chronos AI remains free forever — no subscriptions, no sign-ups, nothing for sale

## Site Structure

- `index.html` — Landing page
- `features.html` — Capabilities
- `about.html` — Project intent and status
- `faq.html` — Common questions
- `download.html` — Getting started and platform status
- `contact.html` — How to reach the project
- `offline.html` — Offline fallback for the installed app
- `styles.css` — Design system and layout
- `script.js` — Navigation and PWA install behaviour
- `service-worker.js` — Offline shell caching
- `manifest.webmanifest` — Web app manifest
- `config.js` — Public Supabase project settings (publishable values only)

## Run locally

Serve the repository over HTTP(S):

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## About Chronos AI

Chronos AI is an independent project — an AI assistant built for thoughtful conversations, creative work, and problem-solving. Designed with privacy and user control in mind, you can run compatible local models on supported hardware for your own AI assistant.

The project remains completely free forever. Nothing here is sold or monetized.

## Design Notes

- Google Fonts is an optional online dependency; local fallback fonts remain.
- Keep large model files out of this website repository.
- Review model and third-party provider licenses before distribution.
