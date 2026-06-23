# PodContext

Download Spotify and YouTube transcripts for LLM context.

A Chrome extension that adds a download button to Spotify podcast episodes and YouTube video transcripts, saving them as plain text files perfect for use with ChatGPT, Claude, and other LLMs.

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `extension` folder

After changing files locally, click **Reload** on the unpacked extension card in `chrome://extensions/`.

## Usage

### Spotify Podcasts

1. Go to [Spotify Web Player](https://open.spotify.com/)
2. Navigate to any podcast episode with a transcript
3. Interact with the page first (e.g., click play/pause) to allow the extension to capture auth tokens
4. Click the green **Download Transcript** button
5. If Spotify returns speaker labels, a dialog appears letting you rename them
6. The transcript saves as a timestamped `.txt` file

### YouTube Videos

1. Go to [YouTube](https://www.youtube.com/)
2. Navigate to any video with captions/subtitles
3. Click **"...more"** below the video description, then click **"Show transcript"**
4. Once the transcript panel opens, you'll see a red **Download Transcript** button at the top
5. Click it to download the transcript as a `.txt` file

## Output Formats

### Spotify
```
[0:00] Welcome to the show. Today we're discussing...
[0:12] Speaker 1: Thanks for having me. I think the key point is...
```

### YouTube
```
[0:00] Welcome to this video about...
[0:05] Today we'll be covering...
[1:03] The first important point is...
```

## Troubleshooting

### Spotify

| Issue | Solution |
|-------|----------|
| "Auth tokens not captured" | Interact with the Spotify page (play/pause, click around) then try again |
| "No transcript available" | Not all episodes have transcripts - check if Spotify shows a "Transcript" button |
| "Transcript is empty" | Reload the unpacked extension. Current versions support Spotify's `section[].text.sentence` transcript shape and fall back to the visible transcript text on the page. |
| Button not appearing | Make sure you're on an episode page (URL contains `/episode/`) |

### YouTube

| Issue | Solution |
|-------|----------|
| Button not appearing | Make sure you've opened YouTube's transcript panel first (click "...more" → "Show transcript") |
| "No transcript segments found" | The transcript may still be loading - wait a moment and try again |
| No "Show transcript" option | The video doesn't have captions/transcripts available |

## How It Works

### Spotify
The extension intercepts Spotify's authentication tokens from network requests, then uses them to fetch transcripts from Spotify's internal API. It parses Spotify's current `transcript-read-along/v2` response shape and falls back to the visible transcript text in the page when the API cannot be read.

### YouTube
The extension watches for YouTube's transcript panel to open. Once you click "Show transcript" on a video, a download button appears in the transcript panel. Clicking it extracts the transcript text directly from the page - no API calls needed, so it works reliably with any video that has captions.

## License

MIT
