# Configuration Reference

## Required Environment Variables

- `OPENAI_API_KEY`: Key used to generate draft post text.
- `LINKEDIN_POST_AUDIENCE`: Target audience summary.
- `LINKEDIN_POST_STYLE`: Style hint such as `operator`, `founder`, `technical`.

## Optional Environment Variables

- `LINKEDIN_POST_TOPIC`: Explicit daily topic.
- `LINKEDIN_POST_MAX_CHARS`: Maximum post length. Default `800`.
- `LINKEDIN_POST_LANGUAGE`: Output language. Default `en`.
- `AUTO_PUBLISH`: `true` or `false`. Default `false`.
- `PUBLISH_MODE`: `manual`, `did-cdp`, or `linkedin-api`. Default `manual`.
- `DID_BROWSER_CDP_URL`: Required for `did-cdp` mode.
- `LINKEDIN_API_ACCESS_TOKEN`: Required for `linkedin-api` mode.
- `LINKEDIN_AUTHOR_URN`: Required for `linkedin-api` mode.

## Output Paths

- Generated post: `skills/linkedin-daily-post/runs/YYYY-MM-DD.post.txt`
- Run metadata: `skills/linkedin-daily-post/runs/YYYY-MM-DD.result.json`
- Logs: `skills/linkedin-daily-post/runs/logs/daily.log`

## Scheduler Expectations

- Scheduler should run once every day.
- Scheduler must call `scripts/run_daily_job.sh`.
- Scheduler should include workspace root as the working directory.
