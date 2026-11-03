// What the composer has picked, shared by the overview, the score and the inspector, so all three show the same thing.
export type Selection =
  | { kind: "attention"; id: string }
  | { kind: "section"; from: string; to: string }
  | { kind: "bars"; from: string; to: string }
  | { kind: "lane"; line: string };
