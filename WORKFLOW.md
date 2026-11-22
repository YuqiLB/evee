# evee: how it works

evee listens to a live pitch. When someone asks a question or the talk moves to a new topic, it composes a slide from the founder's own uploads and shows it within a few seconds. Afterwards it collects the visitor's email and drafts a follow-up from what was asked.

## The whole system

```mermaid
flowchart LR
  subgraph Before["Setup screen"]
    U["Founder drops PDFs, images, text and extra facts"] --> P["Browser builds the context pack: text chunks and page images, each with an id"]
  end
  subgraph Live["Pitch screen, all in the browser"]
    M["Laptop mic"] -->|live audio| A["ElevenLabs Agent: hears and decides"]
    A -->|show_slide| S["Composed slide: title, bullets, stat, image"]
    A -->|log_followup| N["Noted for follow-up"]
    A -->|skip_turn| Q["Stays silent"]
  end
  subgraph After["Follow-up screen"]
    E["Email and summary"]
    SV["Server saves the session"]
    D["Server drafts the follow-up"]
    AP["Founder approves"]
    SEND["Sent through Alter and Resend"]
    E --> SV --> D --> AP --> SEND
  end
  P -->|context pack, sent once at start| A
  A -->|capture_email| E
  S --> SV
  N --> SV
```

## One question, start to finish

```mermaid
sequenceDiagram
  participant V as Visitor
  participant B as Browser
  participant E as ElevenLabs Agent
  V->>B: "How much does it cost?"
  B->>E: live audio
  Note over E: turns speech into text
  Note over E: notices the question has ended
  Note over E: LLM finds the answer in the context pack
  E->>B: show_slide with title, bullets, stat
  Note over B: renders the slide locally
```

```mermaid
pie showData
  title Where the 2.5 seconds go (estimate, to be measured)
  "Speech to text" : 0.2
  "Noticing the question ended" : 0.8
  "LLM writes the slide" : 1.4
  "Browser shows it" : 0.1
```

Target is under 5 seconds. The server is not in this path.

## What evee does with what it hears

| What is said | Example | evee does | Tool |
|---|---|---|---|
| A question the uploads answer | "How big is the market?" | Shows a slide with the answer | `show_slide` |
| A clear move to a new topic | "Let's talk about pricing." | Shows a slide for that topic | `show_slide` |
| A question the uploads do not answer | "Do you integrate with Salesforce?" | Shows "Noted for follow-up", logs it | `log_followup` |
| Small talk, half sentences, more on the same topic | "Nice booth!" | Nothing | `skip_turn` |
| The same slide again within 6 seconds | | Ignored by the browser | none |
| Founder ends the pitch (End button or Esc) | | evee speaks, asks for the email, spells it back | `capture_email` |

## Screens

```mermaid
stateDiagram-v2
  [*] --> Setup
  Setup --> Pitch: start, agent session opens
  Pitch --> Pitch: every turn ends in one tool call
  Pitch --> Followup: End button or Esc, agent asks for the email
  Followup --> Sent: founder approves the draft
  Sent --> [*]
```

## Where things live

| Piece | Where |
|---|---|
| Agent prompt and tool schemas | `agent/prompt.md`, `agent/tools.json`, pasted into the ElevenLabs dashboard |
| Agent session and client tools | `src/client/lib/agent.js` |
| Context pack from uploads | `src/client/lib/context.js` |
| Screens | `src/client/screens/` |
| Session and follow-up actions | `src/server/session.js`, `src/server/followup.js` |
| Server protocol and the Maritime plug point | `PROTOCOL.md` |

## Partner tools

| Tool | When | Job | State |
|---|---|---|---|
| ElevenLabs Agents | Live | Listens, composes slides, asks for the email | Code done; agent to be created in the dashboard |
| Alter | After | Holds the follow-up send for approval | Code done; dry run without keys |
| Resend | After | Delivers the email, called through Alter | Code done |
| Maritime | After | Would write the follow-up | Not wired; see `PROTOCOL.md` |

## To the deadline

```mermaid
gantt
  title Remaining work to 3:00
  dateFormat HH:mm
  axisFormat %H:%M
  section Voice
  Create agent in dashboard     :a1, 12:40, 20m
  Test on sample and real deck  :a2, after a1, 30m
  Tune prompt                   :a3, after a2, 30m
  section Ship
  Feature freeze                :milestone, m1, 14:15, 0m
  Record video                  :v1, 14:30, 15m
  Submit                        :milestone, m2, 14:45, 0m
  Hard deadline                 :crit, milestone, m3, 15:00, 0m
```
