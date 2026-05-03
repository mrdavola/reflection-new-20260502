# Peer Voting Feature — Design Spec

**Date:** 2026-05-03  
**Feature:** Post-reflection peer voting where students anonymously vote on the best peer responses  
**Status:** Approved for implementation

## Overview

After students complete a reflection routine, they enter a **two-round peer voting phase** where they anonymously vote on the best peer responses. The winning responses are revealed to the class and can be used as discussion seeds. This feature supports four pedagogical goals:
1. **Surface the best takeaway** — class collectively elevates the strongest reflection
2. **Build evaluation skills** — students practice judging quality of thinking
3. **Engagement** — gamify the routine to motivate quality work
4. **Discussion seed** — generate standout responses for whole-class discussion

---

## Goals & Constraints

**Pedagogical goals:**
- All four above must be supported by the design
- Peer voting should increase student motivation to produce substantive responses
- Voting should be fast (< 5 minutes total, ideally < 3) so classroom time is preserved
- The winning response(s) should be usable immediately for discussion

**Technical constraints:**
- Build on existing session/reflection architecture
- Reuse existing safety pipeline (`safety.ts`)
- Preserve anonymity to peers (optional teacher reveal)
- Support all class sizes (5+ students, ideally)

**Teacher control:**
- Teacher paces the voting flow (not automatic)
- Teacher can toggle voting per session
- Teacher can exclude amber-flagged content before voting starts
- Teacher controls celebration animation

---

## Data Model

### Routine Definition Changes

Add two fields to each routine in `routines.ts`:

```ts
type RoutineDefinition = {
  // ...existing fields...
  peerVotingDefault: boolean;          // whether voting is enabled by default
  headlineStep?: RoutineStepLabel;     // which step's response gets voted on
};
```

**Voting enabled by default for:**
- **See Think Wonder** (`headlineStep: "Wonder"`)
- **I Used to Think… Now I Think** (`headlineStep: "Now I Think"`)
- **Claim Support Question** (`headlineStep: "Claim"`)

**Voting disabled by default for:**
- **Would You Rather** (responses are transactional, not substantive)
- **Exit Ticket** (short, not suitable for peer comparison)
- **Reflection Spinner** (single-response, no peer pool)

### Session Configuration Changes

Add to `SessionConfig` in `types.ts`:

```ts
type SessionConfig = {
  // ...existing fields...
  peerVotingEnabled?: boolean;           // overrides routine default
  headlineStepOverride?: RoutineStepLabel; // teacher picks different step
  celebrationAnimationEnabled?: boolean;   // show animation on reveal (default: false)
};
```

### Session Document Changes

Add to the `Session` Firestore document:

```ts
type Session = {
  // ...existing fields...
  votingState: "inactive" | "review_pending" | "round_1" | "finals_pending" 
            | "finals" | "reveal" | "discuss" | "ended";
  
  votingPool?: {
    eligibleReflectionIds: string[];     // safe to show in voting
    excludedRedIds: string[];             // auto-excluded (safety red)
    excludedAmberIds: string[];           // teacher-excluded (safety amber)
    finalistReflectionIds?: string[];     // top 4-6 advancing to finals
    winnerReflectionId?: string;          // the winner
    rankedTop3?: Array<{
      reflectionId: string;
      studentName: string;                // visible only to teacher
      voteCount: number;
    }>;
  };
};
```

### New Collection: `peerVotes`

```ts
type PeerVote = {
  id: string;                    // auto-generated
  sessionId: string;
  voterStudentId: string;
  round: 1 | 2;                  // which round
  votedForReflectionId: string;  // the response they picked
  createdAt: Timestamp;
};
```

---

## Voting Flow

### Precondition

Voting is **auto-skipped** if:
- Routine has `peerVotingDefault: false` and session hasn't overridden it
- Fewer than 5 students in the session
- All responses are flagged as red (safety)

Otherwise, voting is offered after all students have submitted.

### State Machine

```
reflecting 
  ↓
review_pending (teacher sees amber-flagged responses, gates voting)
  ↓
round_1 (each student sees 4 random peer responses, votes on 1)
  ↓
finals_pending (server aggregates, advances top 4-6)
  ↓
finals (all students see same 4-6 finalists, vote on 1 winner)
  ↓
reveal (winning response shown with rank)
  ↓
discuss (optional teacher-led discussion mode)
  ↓
ended
```

### Round 1 (Sampling Round)

**Teacher action:** Taps "Start voting" on the live dashboard.

**Server:**
1. Collects all students' headline-step responses
2. Runs each through `safety.ts` analyzer
3. **Red flags** (self-harm, threats, abuse, personal safety): auto-excluded, not shown to teacher
4. **Amber flags** (low_depth, profanity, negative_tone, classmate name): surface to teacher for 30s review

**Teacher action:** Reviews amber-flagged responses in a modal.
- Shows response + reason
- Taps **Include** or **Exclude** for each
- Default (if no action in 30s): Exclude (safer default)
- Session advances to `round_1` once amber is cleared

**Student experience:**
- Each student sees **4 anonymous headline-step responses** from peers (their own excluded)
- Responses shown in randomized order
- Student taps one response to vote for it
- If fewer than 4 responses available, show all

**Sampling algorithm:**
- Ensure each response appears in roughly the same number of student ballots
- For N students with M eligible responses:
  - Small class (N ≤ 7): each student sees min(3, M-1)
  - Large class (N > 7): each student sees min(4, M-1)
- Use deterministic shuffling (seeded by session ID) for consistency

**Voting closes when:**
- Teacher taps "Advance to finals" OR
- All students have voted (whichever comes first)

**Aggregation:**
- Count votes per response
- Top 4 responses advance (or fewer if class is small, or all tied responses advance)
- Ties broken randomly

### Round 2 (Finals)

**Server action:** After round 1 closes, finalists are locked.

**Student experience:**
- All students see the **same 4 finalist responses** in randomized order
- Each taps one to vote
- Voting closes when teacher taps "Reveal winner" OR all vote

**Teacher action:** Taps "Reveal winner."

---

## Safety & Moderation

**Red-flagged responses** (flagged in `safety.ts` with severity "red" for personal_safety, self_harm, violence, abuse, threat):
- Auto-excluded from voting pool
- Not shown in amber review modal
- Student doesn't see they were excluded
- Teacher sees "excluded from voting" tag on dashboard

**Amber-flagged responses** (severity "amber" for low_depth, profanity, negative_tone):
- Surfaced to teacher immediately after "Start voting"
- Teacher sees a modal with up to 5 responses, each with the flag reason
- Teacher taps Include/Exclude (can bulk-action or do individually)
- 30-second auto-timeout defaults all to Exclude if teacher doesn't act

**If entire pool is excluded:**
- Voting is skipped, session advances to `ended`
- Teacher shown a notice: "All responses were flagged for safety. Voting skipped."

---

## Reveal & Celebration

### Reveal to Class

After finals close, teacher taps "Reveal winner":

1. **Optional celebration animation** (if `celebrationAnimationEnabled = true`):
   - 3-second confetti/reveal animation
   - Shows winner card
   - Then transitions to ranked top 3

2. **Ranked top 3 display:**
   - Winner + vote count in first position
   - Runner-up in second
   - Third place in third
   - Responses stay anonymous to peers unless teacher explicitly taps "Reveal authors"

3. **On teacher screen:**
   - Top 3 with author names (for context)
   - Vote counts
   - Two buttons: **"Discuss"** and **"Show authors to class"**

### Discussion Mode (Optional)

If teacher taps "Discuss":
- Full-screen view of winning response (large, centered)
- Side prompts for whole-class discussion:
  - *"What made this response strong?"*
  - *"What thinking move was happening here?"*
  - *"How does this compare to your own response?"*
- Students see a read-only view (no interaction)
- Teacher leads discussion from their screen

### Data Saved to Session Record

- Top 3 responses (full text + metadata)
- Vote counts
- Headline step that was voted on
- Author names (teacher access only)
- `votingPool` state in session document

---

## API Surface

All endpoints live under `/api/session/[sessionId]/voting/`.

### Teacher endpoints (require session ownership)

- **POST /start**
  - Triggers safety pass
  - Returns list of amber-flagged responses + reason
  - Sets state to `review_pending`

- **POST /resolve-amber**
  - Payload: `{ amber: [{ reflectionId, decision: "include" | "exclude" }] }`
  - Updates `votingPool.excludedAmberIds`
  - Sets state to `round_1`

- **POST /advance**
  - Payload: `{ action: "round_1_to_finals" | "finals_to_reveal" | "reveal_to_discuss" | "discuss_to_ended" }`
  - Aggregates votes if needed
  - Sets new state

- **POST /reveal-authors**
  - Broadcasts author names to students (optional)

- **GET /live**
  - Polled by teacher dashboard
  - Returns current vote counts (live)

### Student endpoints (require valid session token)

- **GET /ballot**
  - Returns current ballot based on `votingState`
  - If `round_1`: 4 anonymous responses + metadata
  - If `finals`: 4-6 finalist responses + metadata
  - If `reveal`: winning response + top 3 ranking
  - If `discuss`: winning response for discussion view

- **POST /vote**
  - Payload: `{ reflectionId: string }`
  - Records vote to `peerVotes` collection
  - Returns success or error

### Error handling

- **Vote submit timeout:** queued locally, retried until success
- **Vote twice (same round):** last vote wins
- **Browser close mid-voting:** vote discarded, student rejoins at current ballot
- **All responses excluded:** voting skipped, session advances with teacher notice
- **Tied vote counts:** both responses advance, ranked list shows as tied

---

## Edge Cases & Constraints

**Class size handling:**
- < 5 students: voting auto-skipped
- 5–7 students: each sees 3 responses, 3 finalists
- 8+ students: each sees 4 responses, 4 finalists

**Timing:**
- Sample round: students see ballot immediately, vote at own pace
- Finals: happens after round 1 aggregates (< 10s server time)
- Reveal: immediate once teacher taps

**Anonymity:**
- Responses anonymous to peer voters by default
- Teacher can reveal author names to students after reveal
- Author names always visible to teacher (for context)

**Closed student (absent/didn't submit):**
- Can still vote (votes on peer responses only)
- Counted in participant base for sampling

**Tied votes in finals:**
- Both/all tied responses advance to next step
- Ranked display shows them as tied
- If tie exists in top 3: all tied responses shown in top 3

**What's voted on:**
- By default: the `headlineStep` of the routine
- Teacher can override at session creation to pick a different step
- Same step shown to all students for that session

---

## Out of Scope (Not This Spec)

- Student can re-vote or change vote (1 vote per round, final)
- Historical voting analytics / trends across sessions
- Vote export/analysis for teacher reporting
- Vote delegation (absent student proxy voting)
- Voting on multiple steps simultaneously
- Weighted votes (e.g., teacher vote counts as 2)
- Voter anonymity to teacher (teacher sees all votes)
- Anonymous feedback on why a response ranked well/poorly
- Follow-up prompts based on votes ("Do you agree with the class?")

---

## Success Criteria

- Students perceive voting as fair and fun (survey TBD)
- Winning response is substantive and usable for discussion
- Voting completes in < 5 minutes of class time
- Zero false positives (amber-flagged content that teacher wants included is easy to un-exclude)
- Teacher adoption rate: at least 50% of sessions enable voting within first 3 weeks
- No performance regression on live dashboard (voting tallying is < 500ms)

---

## Implementation Order

This is filled in by the implementation plan, but at a high level:

1. Update `RoutineDefinition` types and add voting defaults
2. Update `SessionConfig` types
3. Build API endpoints (`/api/session/[sessionId]/voting/...`)
4. Add Firestore schema for `peerVotes`
5. Build teacher "Start voting" flow + amber review modal
6. Build student ballot views (round 1, finals, reveal)
7. Build server-side aggregation logic
8. Add result persistence and display
9. Build optional celebration animation + discussion mode
10. Integration tests + teacher/student E2E testing

---

## Notes

- Reuses existing session polling pattern (2-second refresh on live dashboard)
- Leverages existing `safety.ts` analyzer
- No new external dependencies needed
- Runs entirely within Next.js API routes and Firestore
