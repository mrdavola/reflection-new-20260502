# Peer Voting Feature

## Overview

After students complete a reflection routine, they enter a two-round peer voting phase where they anonymously vote on the best peer responses. Winning responses are revealed to the class and can be used as discussion seeds.

## Pedagogical Goals

1. **Surface the best takeaway** — class collectively elevates the strongest reflection
2. **Build evaluation skills** — students practice judging quality of thinking
3. **Engagement** — gamify the routine to motivate quality work
4. **Discussion seed** — generate standout responses for whole-class discussion

## Architecture

### State Machine

Voting flows through these states:

```
reflecting → review_pending → round_1 → finals_pending → finals → reveal → discuss → ended
```

- **reflecting**: Initial state during student reflection
- **review_pending**: Safety classifier has run; waiting for teacher to resolve amber flags
- **round_1**: Students vote on random sample of 3-4 responses
- **finals_pending**: Round 1 votes tallied; waiting for teacher to advance
- **finals**: Top finalists visible; students vote for ultimate winner
- **reveal**: Winner announced with top 3 ranking
- **discuss**: Read-only discussion view with winner displayed
- **ended**: Voting complete

### Safety Pipeline

Peer Voting integrates a safety classifier (Gemini) that flags responses:

- **Red flags** (personal_safety, self_harm, violence, abuse, threat): Auto-excluded from voting pool, not shown to students or teacher
- **Amber flags** (low_depth, profanity, negative_tone): Surfaced to teacher with reason in a modal; teacher can include or exclude from pool
- **Clean responses**: Eligible for voting immediately

### Two-Round System

**Round 1 (Sampling):** Each student sees 3-4 random peer responses (excluding their own), votes for 1

**Round 2 (Finals):** Top 4-6 responses advance based on round 1 votes; all students see same finalists, vote for 1 winner

Finalist count: 3 for small classes (≤7), 4 for larger classes (8+). Ties are resolved by including all tied responses.

## Configuration

### Per-Routine Defaults

Enable/disable voting by routine:

```typescript
// src/lib/routines.ts
{
  id: 'see-think-wonder',
  name: 'See Think Wonder',
  peerVotingDefault: true,      // voting enabled by default
  headlineStep: 'Wonder',         // which step gets voted on
  // ... other fields
}
```

### Per-Session Overrides

Teacher can enable/disable and customize at session creation:

```typescript
// src/lib/types.ts - SessionConfig
{
  peerVotingEnabled?: boolean,           // overrides routine default
  headlineStepOverride?: RoutineStepLabel; // pick different step
  celebrationAnimationEnabled?: boolean;   // show animation on reveal
}
```

## API Reference

All endpoints live under `/api/session/[sessionId]/voting/`

### Teacher Endpoints

**POST /voting/start**
- Initiates voting flow from `reflecting` state
- Classifies all headline responses for safety flags
- Returns amber-flagged responses with category and reason
- Sets state to `review_pending`
- Payload: `{ teacherId: string }`
- Response: `{ skipped?: boolean; amber?: Array<{ reflectionId, studentName, category, message }> }`

**POST /voting/resolve-amber**
- Teacher gates amber-flagged responses (include/exclude)
- Updates voting pool with decisions
- Sets state to `round_1`
- Payload: `{ amber: [{ reflectionId: string, decision: "include" | "exclude" }] }`
- Response: `{ poolSize: number; excludedCount: number }`

**POST /voting/advance**
- Transitions session through voting states
- On `round_1_to_finals`: aggregates round 1 votes, selects finalists
- On `finals_to_reveal`: aggregates round 2 votes, determines winner and top 3
- On `reveal_to_discuss` or `discuss_to_ended`: state transition only
- Payload: `{ action: "round_1_to_finals" | "finals_to_reveal" | "reveal_to_discuss" | "discuss_to_ended" }`
- Response: `{ state: VotingState; winner?: { reflectionId, studentName, voteCount } }`

**GET /voting/live**
- Returns current vote tallies for teacher dashboard
- Polled every 2 seconds during active rounds
- Response: `{ round1Votes?: Record<string, number>; round2Votes?: Record<string, number> }`

**POST /voting/reveal-authors** (optional)
- Optionally broadcasts author names to students after reveal
- Payload: `{ revealed: boolean }`
- Response: `{ revealed: boolean }`

### Student Endpoints

**GET /voting/ballot**
- Returns current ballot based on `votingState`
- Round 1: 3-4 anonymous responses (excludes voter's own)
- Finals: 4-6 finalist responses
- Reveal: winning response with top 3 ranking
- Response: `{ state: VotingState; responses: Array<{ id, content }> | { winner, top3 } }`

**POST /voting/vote**
- Records vote to `peerVotes` collection
- One vote per round per student
- Payload: `{ reflectionId: string }`
- Response: `{ success: boolean; round: 1 | 2 }`

## Data Model

### Session Document Extensions

```typescript
type Session = {
  // ... existing fields ...
  votingState: VotingState;
  votingPool?: VotingPool;
}

type VotingState = "inactive" | "review_pending" | "round_1" | 
                    "finals_pending" | "finals" | "reveal" | "discuss" | "ended";
```

### VotingPool

```typescript
type VotingPool = {
  eligibleReflectionIds: string[];           // responses eligible for voting
  excludedByRedAlertIds: string[];           // auto-excluded by safety
  excludedByAmberAlertIds: string[];         // excluded by teacher decision
  finalistReflectionIds?: string[];          // top finalists after round 1
  winnerReflectionId?: string;               // winner after round 2
  rankedTop3?: Array<{
    reflectionId: string;
    studentName: string;
    voteCount: number;
  }>;
};
```

### PeerVote Collection

Each document represents one student's vote in one round:

```typescript
type PeerVote = {
  id: string;
  sessionId: string;
  voterStudentId: string;
  round: 1 | 2;
  votedForReflectionId: string;
  createdAt: Date;
  updatedAt?: Date;
};
```

**Firestore Path:** `sessions/{sessionId}/peerVotes/{voteId}`

## UI Components

### Teacher Side

Located in `/src/app/teacher/session/[sessionId]/`

- **VotingControls** (`voting-controls.tsx`): State-dependent buttons for pacing flow
  - Shows different buttons: "Start Voting", "Advance to Ballots", "Advance to Finals", "Reveal Winner", "End Voting"
  - Disabled while votes are being aggregated

- **VotingAmberModal** (`voting-amber-modal.tsx`): Review and gate amber-flagged responses
  - Modal overlay with flagged response content, category, and reason
  - Include/Exclude toggle for each
  - Confirm button to proceed to round 1

- **VotingResults** (`voting-results.tsx`): Display top 3 with rankings and vote counts
  - Shows winner and top 3 results during reveal and discuss phases
  - Vote counts visible to teacher

### Student Side

Located in `/src/app/student/session/[sessionId]/`

- **VotingBallot** (`voting-ballot.tsx`): Round 1 / Finals ballot with response selection
  - Shows multiple responses (anonymous)
  - Radio button or card selection for voting
  - Submit button records vote

- **VotingReveal** (`voting-reveal.tsx`): Winner announcement with optional animation and top 3 ranking
  - Displays winning response prominently
  - Top 3 ranking with vote counts (if not anonymous)
  - Optional celebration animation

- **VotingDiscuss** (`voting-discuss.tsx`): Read-only discussion view with winner displayed
  - Winner response displayed
  - Teacher-led discussion prompts (optional)
  - No further voting possible

## Testing

### Unit Tests

**API Endpoints:** `src/app/api/session/[sessionId]/voting/__tests__/voting-api.test.ts`
- Safety classification and pool building
- State transitions validation
- Vote recording and aggregation
- Finalist selection logic

**Voting Logic:** `src/lib/firebase/voting.test.ts`
- Vote aggregation by round
- Finalist selection with tie-breaking
- Ballot sample generation (seeded randomization)
- Pool building with safety alerts

### Integration Test

**Full Flow:** `src/__tests__/api/voting-integration.test.ts`
- End-to-end test simulating:
  - Start voting → resolve amber → round 1 voting → finals voting → reveal winner
  - Verifies state transitions and data consistency

### E2E Tests

**Browser Testing:** `e2e/voting.spec.ts`
- Real browser simulation with Playwright
- Teacher controls voting phases
- Student concurrent voting experience
- Verify anonymous ballot, reveal, and top 3 display

Run with:
```bash
npm run e2e
npm run e2e:debug    # Step through with debugger
npm run e2e:report   # View test report
```

## Known Limitations

- **1 vote per round** — Students cannot re-vote or change their vote within a round
- **No historical analytics** — Voting data not aggregated across sessions
- **No voter anonymity control** — Teacher sees all votes (voter anonymity to students only)
- **No vote delegation** — Absent students cannot delegate their vote

## Future Enhancements

- Voter anonymity option for teacher view
- Vote change/revision within a round before finalization
- Historical voting trends dashboard
- Student feedback on why a response ranked well
- Weighted voting (e.g., teacher vote counts as 2)
- Peer voting on multiple steps (not just headline step)
- AI-suggested discussion prompts based on winner

## Troubleshooting

### Voting not starting

- Minimum 5 reflections required to start voting
- Check that `peerVotingEnabled !== false` in session config
- Check that `peerVotingDefault !== false` for the routine

### Amber flags not appearing

- Verify Gemini API key is configured (`GEMINI_API_KEY`)
- Check network logs for `/voting/start` response
- Ensure responses contain text that might trigger safety classifier

### Votes not being recorded

- Verify student is in the correct `votingState` for their round
- Check that they haven't already voted this round
- Check Firestore `peerVotes` collection for successful writes

### Teacher cannot advance to finals

- Ensure all students have voted in round 1 (or waiting period expires)
- Check that finalist count is valid (at least 3)
- Verify `/voting/advance` endpoint response for errors
