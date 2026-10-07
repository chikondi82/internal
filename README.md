# Internal Workspace

## Enable the workspace assistant

The workspace assistant uses GroqCloud's OpenAI-compatible API with the
`openai/gpt-oss-20b` model. Copy `.env.example` to `.env`, add your Groq API
key, then start or restart the app:

```powershell
Copy-Item .env.example .env
# Edit .env and set GROQ_API_KEY to your key.
npm start
```

The local `.env` file is ignored by Git. Keep the key there on the server;
never add it to browser code or commit it. The server verifies Firebase
sign-in tokens for the configured project before making requests, and limits
each signed-in user to 12 assistant requests per minute.

The assistant can answer general work questions, summarize the recent context
on the current page, help plan next steps, and draft chat messages or company
feed updates. It currently receives up to 12 recent messages from the open chat
or 8 recent posts from the feed. This context and the conversation with the
assistant are sent to GroqCloud; review Groq's current privacy, usage, model
availability, and pricing terms before production use. Free-tier availability
and limits can change; check the current GroqCloud account limits.

The assistant cannot independently search all workspace history or perform
workspace actions. Drafts are placed in the appropriate composer only after
the user selects **Use draft**; messages and posts are never sent automatically.
Review all AI responses and drafts before relying on or sharing them.
