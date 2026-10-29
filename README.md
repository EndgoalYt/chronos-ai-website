# Chronos AI Website

A responsive, static download website for Chronos AI. It uses plain HTML, CSS, and JavaScript so it can be hosted free on GitHub Pages.

## Files

- `index.html` — page content and sections
- `styles.css` — responsive design and visual styling
- `script.js` — mobile navigation and footer year
- `assets/chronos-web-logo.png` — Chronos web logo

## Run locally

You can double-click `index.html` to preview it in a browser. For a more reliable local preview, open a terminal in this folder and run one of these if installed:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publish for free with GitHub Pages

1. Create a GitHub repository named `chronos-ai-website`.
2. Upload all files and the `assets` folder to the repository root.
3. In the repository, open **Settings → Pages**.
4. Under build and deployment, choose **Deploy from a branch**.
5. Choose the `main` branch and `/ (root)` folder, then save.
6. Wait for GitHub Pages to publish the site. The URL will look like `https://YOUR-USERNAME.github.io/chronos-ai-website/`.

## Connect a real installer later

The Windows download button is deliberately disabled until a real installer exists.

When the Windows installer has been built and uploaded to GitHub Releases:

1. Open `index.html`.
2. Find the link with `id="windowsDownload"`.
3. Replace `href="#"` with the real release asset URL.
4. Remove `aria-disabled="true"` and the `disabled-button` class.
5. Update the platform cards and requirements with details verified against the actual build.

Do not link to a placeholder or claim macOS/Linux builds are available until they are built and tested.

## Notes

- This is a static website; no backend or database is required.
- The Google Fonts stylesheet uses an online font service. The site still has fallback fonts if that service is unavailable.
- Keep large model files out of the website repository. Host actual application releases separately.
- Review model and third-party provider licenses before distributing Chronos AI or its model files.
