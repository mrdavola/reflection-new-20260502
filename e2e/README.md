# End-to-End Tests – Peer Voting Flow

This directory contains Playwright E2E tests for the peer voting feature, verifying the complete teacher and student voting experience in real browsers.

## Setup

### Prerequisites

- Node.js 18+ installed
- Playwright dependencies already in `package.json`

### Installation

If you haven't already, install Playwright:

```bash
npm install
```

## Running Tests

### Run all E2E tests

```bash
npm run e2e
```

### Run E2E tests in debug mode

```bash
npm run e2e:debug
```

This opens Playwright Inspector, allowing you to step through tests interactively.

### View test report

```bash
npm run e2e:report
```

## Test Structure

### `voting.spec.ts` – Full Peer Voting Flow

Tests the complete voting experience with one teacher and two students:

1. **Teacher starts voting** – Teacher clicks "Start Voting" button
2. **Amber modal appears** – System displays amber-flagged responses for teacher review
3. **Teacher resolves amber** – Teacher includes/excludes responses
4. **Round 1 voting** – Students receive ballot with 3–4 responses, vote independently
5. **Advance to Finals** – Teacher advances to finals round
6. **Finals voting** – Students receive finalist ballot (2–4 responses), both vote for same response
7. **Reveal winner** – Teacher clicks "Reveal Winner", celebration animation plays (optional)
8. **Rankings displayed** – Students see top-ranked responses
9. **Discussion mode** – Teacher enters discussion, students see discussion prompts
10. **End voting** – Teacher ends session

### Test Implementation Details

- **Multi-context architecture**: Uses separate Playwright contexts for teacher and students to simulate concurrent browser sessions
- **Real browser**: Tests run in Chromium
- **Polling**: Students' pages poll the `/api/session/[sessionId]/voting/ballot` endpoint to get voting state
- **Selectors**: All assertions use `data-testid` attributes for stability

## Test Selectors (data-testid)

The test relies on these selectors being present in the UI components:

### Teacher Components
- `start-voting-button` – Start Voting button (voting-controls.tsx)
- `amber-modal` – Amber review modal container (voting-amber-modal.tsx)
- `amber-response` – Individual amber response item
- `amber-include-button` – Include decision button
- `amber-exclude-button` – Exclude decision button
- `amber-confirm-button` – Confirm/Continue button
- `advance-to-finals-button` – Advance to Finals button (voting-controls.tsx)
- `reveal-winner-button` – Reveal Winner button (voting-controls.tsx)
- `start-discuss-button` – Start Discussion button (voting-controls.tsx)
- `end-voting-button` – End Voting button (voting-controls.tsx)

### Student Components
- `voting-ballot` – Round 1 or Finals voting ballot (voting-ballot.tsx)
- `response` – Individual response option on ballot
- `voting-reveal` – Winner reveal view (voting-reveal.tsx)
- `celebrate-animation` – Celebration animation (if enabled)
- `ranked-top3` – Rankings container
- `rank-1`, `rank-2`, `rank-3` – Individual ranking items
- `voting-discuss` – Discussion view (voting-discuss.tsx)
- `discuss-prompts` – Discussion prompts container
- `discuss-prompt` – Individual discussion prompt

## Configuration

Configuration is in `playwright.config.ts`:

- **Test directory**: `./e2e`
- **Base URL**: `http://localhost:3000`
- **Browser**: Chromium
- **Reporter**: HTML (saved to `playwright-report/`)
- **Web server**: Next.js dev server (auto-started, reused if already running)

## Requirements for Tests to Pass

1. **Dev server running**: Tests expect the dev server to be available at `http://localhost:3000`
2. **Database**: Tests require a database (Firebase/Supabase) with:
   - Session endpoint that responds to valid tokens
   - Reflection/response data
   - Voting state management
3. **Authentication**: Tests use token-based auth; tokens are generated per test run
4. **API endpoints**: All voting endpoints must be functional:
   - `POST /api/session/[sessionId]/voting/start`
   - `POST /api/session/[sessionId]/voting/resolve-amber`
   - `GET /api/session/[sessionId]/voting/ballot`
   - `POST /api/session/[sessionId]/voting/vote`
   - `POST /api/session/[sessionId]/voting/advance`

## Troubleshooting

### Test times out waiting for button

- Verify the dev server is running on `http://localhost:3000`
- Check that voting-related components are rendering correctly
- Ensure testids are present in the components

### Sessions don't exist

- Tests use dynamically generated session IDs (`e2e-voting-test-${timestamp}`)
- Make sure the session creation/fetch APIs are working
- Check database for proper session initialization

### Students not receiving ballots

- Verify polling logic in `student-routine.tsx` is working
- Check `/api/session/[sessionId]/voting/ballot` endpoint
- Ensure voting state transitions are correct

### Amber modal doesn't appear

- Verify reflections have safety flags
- Check `buildVotingPool()` logic in voting APIs
- Ensure amber responses exist (3 expected per spec)

## CI/CD Integration

For GitHub Actions or similar CI systems:

```yaml
- name: Run E2E tests
  run: npm run e2e
  
- name: Upload test report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
```

## Notes

- Tests are designed for sequential execution (one test at a time)
- Full test run takes ~30–60 seconds depending on network/system speed
- Tests create isolated browser contexts (teacher, student1, student2) that don't interfere with each other
- Celebration animation timing (3s) is baked into the test; adjust if animation duration changes
