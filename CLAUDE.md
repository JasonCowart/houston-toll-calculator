# Notes for Claude

- **Read `BACKLOG.md` at the start of every session.** It lists the ideas, open work and on-hold decisions, each with why we want it.
- **Keep `BACKLOG.md` current as you go:**
  - When an idea is raised but not done, add it with a line on *why*.
  - When an idea is put on hold, record what it's waiting on.
  - When something ships, move it to Done with the date.
  - Do this in the same session the idea comes up. Don't leave it for later, because older chat history gets condensed and the details are lost.
- **Workflow:**
  - Commit to the `preview` branch, which publishes at `/preview/`.
  - When Jason says "push it", fast-forward `main` to `origin/preview`, push, and confirm the deploy succeeded.
- **Tests to run before committing:**
  - `node tools/test_tolls.js`
  - `node tools/test_trips.js`
