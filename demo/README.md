# Demo videos

A 4:45 walkthrough of Agile Project UI, in English and Spanish. Both versions use the same footage; only the narration, captions and titles differ.

| Language | Video                                                                | Subtitles                                                                 |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| English  | [agile-project-ui-demo-en.mp4](agile-project-ui-demo-en.mp4) (45 MB) | [VTT](agile-project-ui-demo-en.vtt) · [SRT](agile-project-ui-demo-en.srt) |
| Español  | [agile-project-ui-demo-es.mp4](agile-project-ui-demo-es.mp4) (45 MB) | [VTT](agile-project-ui-demo-es.vtt) · [SRT](agile-project-ui-demo-es.srt) |

GitHub does not play MP4 files stored in a repository. Open a video, choose **View raw** to download it and play it locally. Captions are also burned into the picture.

## Chapters

| Start | Chapter                  |
| ----- | ------------------------ |
| 0:00  | Introduction             |
| 0:16  | What Agile Project UI is |
| 0:30  | 01 · Open your project   |
| 0:50  | 02 · Documents           |
| 1:14  | 03 · Work                |
| 1:52  | 04 · Editing             |
| 2:39  | 05 · Discussions         |
| 3:17  | 06 · Git connector       |
| 3:55  | 07 · Jira and Confluence |
| 4:18  | 08 · Get started         |

## How it was recorded

- The public web app ran in desktop Chrome with the fictional Community Garden project, in BMAD Method 6.12.0 format. No real project or account appears. The recording used version 0.1.0 (revision `dbcfec3`), so later releases may look slightly different.
- Browser automation cannot operate the operating system's folder picker. The recording uses the same disk-backed picker substitute as the automated acceptance tests; everything else is the production application.
- The Git connector performs a real reviewed commit and push to a local test repository.
- Jira runs through the real connector with a local mock provider, labelled on screen. No Atlassian account was used.
- The narration is AI-generated with a local text-to-speech model. Music and sound effects are procedurally generated.

The animation at the top of the main [README](../README.md) is a silent 23-second excerpt of the English video.
