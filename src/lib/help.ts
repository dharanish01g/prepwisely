// Help page content for the company-side roles (see ROLES.md / SIDEBAR.md). College-side roles (tpo, faculty,
// student) are not covered yet.
//
// `pages` describes the role's sidebar pages by page id. Only pages that are built get a line here, and Help
// lists only those, so a "Coming soon" page stays out of Help until someone adds its description.

export interface RoleHelp {
  title: string;
  summary: string;
  pages: Record<string, string>;
  /** Typical order of work, if the role has one. */
  steps?: string[];
}

export const ROLE_HELP: Record<string, RoleHelp> = {
  superadmin: {
    title: "Superadmin",
    summary:
      "You have full access to the whole platform. Your main job is keeping an eye on it: colleges, staff accounts and how things are running. You also run content day to day, the same way a content manager does.",
    pages: {
      colleges: "Every client college on the platform. Open one to see its details, and suspend or reactivate it. Only you can change a college's status.",
      "depts-batches": "Pick any college to see and manage its departments and batches, the same way its onboarding manager does.",
      "user-management": "Every staff account. Add accounts, edit someone's details or role, and reset passwords.",
      categories: "The topic tree questions are filed under (for example Technical › Java). Only you can add or edit categories.",
      briefs: "Tell creators what to write: a category, easy/medium/hard targets and a deadline, assigned to one or more creators. Track progress and close a brief when it's done.",
      "question-bank": "Every question on the platform, drafts included. Search and filter, and archive a question to keep it out of tests (or restore it).",
      "content-team": "Content creator and reviewer accounts. Add, edit, reset passwords, and deactivate or reactivate them.",
      "quality-guidelines": "The quality bar reviewers check questions against. You can edit it; creators and reviewers read it.",
    },
    steps: [
      "Set up the categories questions will be filed under.",
      "Create a brief and assign it to creators, the same way a content manager does.",
      "Creators write and submit questions; reviewers approve them. Only approved, non-archived questions can be used in tests.",
      "Watch progress on Briefs & targets and close each brief when its targets are met.",
    ],
  },
  content_manager: {
    title: "Content manager",
    summary:
      "You decide what content is needed: which topics, how many questions, and how good they must be. You direct the creators and reviewers and manage their accounts.",
    pages: {
      briefs: "Tell creators what to write: a category, easy/medium/hard targets and a deadline, assigned to one or more creators. Track each creator's contribution and close a brief when it's done.",
      "question-bank": "Every question that has been submitted. Search and filter, and archive a question to keep it out of tests (or restore it).",
      "content-team": "Content creator and reviewer accounts. Add, edit, reset passwords, and deactivate or reactivate them.",
      "quality-guidelines": "The quality bar reviewers check questions against. You write it; creators and reviewers read it.",
    },
    steps: [
      "Keep the Quality guidelines up to date so creators and reviewers work to the same bar.",
      "Create a brief (category, targets per difficulty, deadline) and assign creators to it.",
      "Creators write and submit questions against the brief; reviewers approve them.",
      "Only approved, non-archived questions count toward a brief. Close the brief when its targets are met.",
    ],
  },
  content_creator: {
    title: "Content creator",
    summary:
      "You write the multiple-choice questions students answer, usually against a brief your content manager assigns you.",
    pages: {
      "my-assignments": "The briefs assigned to you: category, targets per difficulty, deadline and progress so far. Start a question for a brief from here.",
      "write-question": "Write a question: title, description, category, difficulty and at least two options with exactly one correct. Every option needs an explanation of why it's right or wrong.",
      "my-questions": "Everything you've written, filtered by status. Edit drafts and returned questions, or import many questions at once from a CSV/Excel file.",
      "reviewer-feedback": "Questions a reviewer sent back, with their comments. Open one to fix it and resubmit.",
      "quality-guidelines": "The quality bar your questions are reviewed against. Read it before you write.",
    },
    steps: [
      "Check My assignments for the briefs you're writing for.",
      "Write the question. Save it as a draft, or submit it for review when it's ready.",
      "A reviewer approves it, asks for changes, or rejects it.",
      "If it comes back, fix it from Reviewer feedback and resubmit. Editing an approved question sends it back for review.",
    ],
  },
  content_reviewer: {
    title: "Content reviewer",
    summary:
      "You check every question before it can appear in a test: is it correct, clear, and at the right difficulty?",
    pages: {
      "review-queue": "Questions waiting for review. Open one, check it, then approve, request changes or reject.",
      "review-history": "Your past decisions.",
      "question-bank": "Read-only search of existing questions, to spot duplicates or overlap.",
      "quality-guidelines": "The quality bar you review against, set by the content manager.",
    },
    steps: [
      "Open a question from the Review queue.",
      "Check it against the Quality guidelines, and search the Question bank for duplicates.",
      "Approve it, or request changes / reject it with a comment explaining why.",
      "You can't review questions you wrote yourself.",
    ],
  },
  onboarding_manager: {
    title: "Onboarding manager",
    summary:
      "You bring new client colleges onto the platform and set up what each one needs. You work only with the colleges assigned to you.",
    pages: {
      "my-colleges": "The colleges you're responsible for. Add a new college with a short code (for example SEC), or edit its contact and location details. The code can't be changed later.",
      "depts-batches": "Pick one of your colleges, then add its departments (a short code like CSE and a name). Click a department for its details, or View batches to open its batches page and add batches (a batch is one section of a year's intake): you only enter the graduation year, and the next section's code (for example SEC-CSE-2027-B01, then B02) is generated. The year can't be changed later. Archive what's no longer in use; nothing is deleted.",
    },
    steps: [
      "Add the college with a short unique code (for example SEC), its contact person and location. You're assigned to it automatically. Pick the code carefully: it can't be changed, and batch codes start with it.",
      "On Depts & batches, add the college's departments, then the batches under each one.",
      "Keep its details up to date. Suspending or reactivating a college is done by the superadmin.",
    ],
  },
  support: {
    title: "Support",
    summary:
      "You resolve problems for colleges and students: you can look into any college, student or test, and fix account-level issues. Every fix you make is recorded with a reason.",
    pages: {},
  },
};
