# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voting.spec.ts >> Peer Voting E2E – Teacher + Students >> should complete full voting flow: start → amber → round1 → finals → reveal → discuss
- Location: e2e/voting.spec.ts:44:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="start-voting-button"]')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('[data-testid="start-voting-button"]')

```

# Test source

```ts
  1   | import { test, expect, Browser, Page } from '@playwright/test';
  2   | 
  3   | test.describe('Peer Voting E2E – Teacher + Students', () => {
  4   |   let browser: Browser;
  5   |   let teacherPage: Page;
  6   |   let student1Page: Page;
  7   |   let student2Page: Page;
  8   | 
  9   |   // Test session and user IDs
  10  |   const sessionId = 'e2e-voting-test-' + Date.now();
  11  |   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  12  |   const teacherEmail = 'teacher@example.com';
  13  |   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  14  |   const student1Email = 'student1@example.com';
  15  |   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  16  |   const student2Email = 'student2@example.com';
  17  | 
  18  |   // Mock auth tokens for testing
  19  |   const teacherToken = 'test-teacher-token-' + Date.now();
  20  |   const student1Token = 'test-student1-token-' + Date.now();
  21  |   const student2Token = 'test-student2-token-' + Date.now();
  22  | 
  23  |   test.beforeAll(async ({ playwright }) => {
  24  |     // Create multiple browser contexts for simultaneous user sessions
  25  |     browser = await playwright.chromium.launch();
  26  | 
  27  |     // Teacher context
  28  |     const teacherContext = await browser.newContext();
  29  |     teacherPage = await teacherContext.newPage();
  30  | 
  31  |     // Student 1 context
  32  |     const student1Context = await browser.newContext();
  33  |     student1Page = await student1Context.newPage();
  34  | 
  35  |     // Student 2 context
  36  |     const student2Context = await browser.newContext();
  37  |     student2Page = await student2Context.newPage();
  38  |   });
  39  | 
  40  |   test.afterAll(async () => {
  41  |     await browser?.close();
  42  |   });
  43  | 
  44  |   test('should complete full voting flow: start → amber → round1 → finals → reveal → discuss', async () => {
  45  |     // ============================================
  46  |     // STEP 1: Create test session and reflections via API
  47  |     // ============================================
  48  |     // In a real scenario, you'd either:
  49  |     // 1. Use a test data fixture/seed
  50  |     // 2. Create via API endpoints
  51  |     // 3. Use pre-existing test session in database
  52  |     // For now, we'll navigate to pages and wait for data to exist
  53  | 
  54  |     // Navigate to session pages
  55  |     // Teacher dashboard
  56  |     await teacherPage.goto(`/teacher/session/${sessionId}?token=${teacherToken}`);
  57  | 
  58  |     // Student pages - with polling tokens
  59  |     await student1Page.goto(`/student/session/${sessionId}?token=${student1Token}`);
  60  |     await student2Page.goto(`/student/session/${sessionId}?token=${student2Token}`);
  61  | 
  62  |     // ============================================
  63  |     // STEP 2: Teacher starts voting
  64  |     // ============================================
  65  |     const startVotingButton = teacherPage.locator('[data-testid="start-voting-button"]');
  66  | 
  67  |     // Wait for the button to be visible and enabled
> 68  |     await expect(startVotingButton).toBeVisible({ timeout: 10000 });
      |                                     ^ Error: expect(locator).toBeVisible() failed
  69  |     await expect(startVotingButton).toBeEnabled();
  70  | 
  71  |     await startVotingButton.click();
  72  | 
  73  |     // ============================================
  74  |     // STEP 3: Amber modal appears with responses
  75  |     // ============================================
  76  |     const amberModal = teacherPage.locator('[data-testid="amber-modal"]');
  77  |     await expect(amberModal).toBeVisible({ timeout: 5000 });
  78  | 
  79  |     const amberResponses = teacherPage.locator('[data-testid="amber-response"]');
  80  |     const amberCount = await amberResponses.count();
  81  | 
  82  |     // Expect at least 1 amber response (the spec says 3 amber, but we'll be flexible)
  83  |     expect(amberCount).toBeGreaterThanOrEqual(1);
  84  | 
  85  |     // ============================================
  86  |     // STEP 4: Teacher makes decisions on amber responses
  87  |     // ============================================
  88  |     // Include first 2, exclude third (or all of them if fewer)
  89  |     const amberResponsesList = await amberResponses.all();
  90  | 
  91  |     for (let i = 0; i < amberResponsesList.length; i++) {
  92  |       const response = amberResponsesList[i];
  93  | 
  94  |       if (i < 2) {
  95  |         // Include first 2
  96  |         const includeBtn = response.locator('[data-testid="amber-include-button"]');
  97  |         await includeBtn.click();
  98  |       } else {
  99  |         // Exclude remaining
  100 |         const excludeBtn = response.locator('[data-testid="amber-exclude-button"]');
  101 |         await excludeBtn.click();
  102 |       }
  103 |     }
  104 | 
  105 |     // ============================================
  106 |     // STEP 5: Teacher submits amber decisions
  107 |     // ============================================
  108 |     const confirmButton = teacherPage.locator('[data-testid="amber-confirm-button"]');
  109 |     await expect(confirmButton).toBeVisible();
  110 |     await expect(confirmButton).toBeEnabled();
  111 |     await confirmButton.click();
  112 | 
  113 |     // Modal should disappear after confirmation
  114 |     await expect(amberModal).not.toBeVisible({ timeout: 5000 });
  115 | 
  116 |     // ============================================
  117 |     // STEP 6: Students receive Round 1 ballot
  118 |     // ============================================
  119 |     const student1Ballot = student1Page.locator('[data-testid="voting-ballot"]');
  120 |     const student2Ballot = student2Page.locator('[data-testid="voting-ballot"]');
  121 | 
  122 |     await expect(student1Ballot).toBeVisible({ timeout: 10000 });
  123 |     await expect(student2Ballot).toBeVisible({ timeout: 10000 });
  124 | 
  125 |     // ============================================
  126 |     // STEP 7: Verify 3-4 responses on each ballot
  127 |     // ============================================
  128 |     const student1Responses = student1Ballot.locator('[data-testid="response"]');
  129 |     const student2Responses = student2Ballot.locator('[data-testid="response"]');
  130 | 
  131 |     const count1 = await student1Responses.count();
  132 |     const count2 = await student2Responses.count();
  133 | 
  134 |     // Expect 3-4 responses per ballot
  135 |     expect(count1).toBeGreaterThanOrEqual(3);
  136 |     expect(count1).toBeLessThanOrEqual(4);
  137 |     expect(count2).toBeGreaterThanOrEqual(3);
  138 |     expect(count2).toBeLessThanOrEqual(4);
  139 | 
  140 |     // ============================================
  141 |     // STEP 8: Students vote independently in Round 1
  142 |     // ============================================
  143 |     // Student 1 votes for first response
  144 |     const student1FirstResponse = student1Responses.first();
  145 |     await student1FirstResponse.click();
  146 | 
  147 |     // Small delay to ensure vote is processed
  148 |     await student1Page.waitForTimeout(1000);
  149 | 
  150 |     // Student 2 votes for second response (or first if only 1)
  151 |     const student2FirstResponse = student2Responses.first();
  152 |     await student2FirstResponse.click();
  153 | 
  154 |     // Small delay to ensure vote is processed
  155 |     await student2Page.waitForTimeout(1000);
  156 | 
  157 |     // ============================================
  158 |     // STEP 9: Teacher advances to Finals
  159 |     // ============================================
  160 |     const advanceToFinalsButton = teacherPage.locator('[data-testid="advance-to-finals-button"]');
  161 |     await expect(advanceToFinalsButton).toBeVisible({ timeout: 5000 });
  162 |     await expect(advanceToFinalsButton).toBeEnabled();
  163 |     await advanceToFinalsButton.click();
  164 | 
  165 |     // ============================================
  166 |     // STEP 10: Students receive Finals ballot
  167 |     // ============================================
  168 |     // Ballots should update to show finals round
```