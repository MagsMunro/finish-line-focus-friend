# Finish Line Friend

Tell it what you have to do and when it’s due. It figures out when you should do it and keeps adjusting until you reach 100%.

## Features

- **Setup** — name, classes/periods, get-home time, homework window, recurring commitments
- **Add Homework** — class, assignment, due date/time, estimated minutes, difficulty, notes
- **Today’s Plan** — realistic schedule from deadlines, workload, difficulty, free time, and breaks
- **Finish Line bars** — each class shows semester progress (first day through last day); completing work moves the bar forward and it does not reset daily
- **Chat** — “what’s next?”, “I’m behind”, “I only have 45 minutes”, “I finished early”, “Can I stop for today?”
- **Focus Music** — optional local calm tone (off by default)

## Run

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Flow

1. Complete setup once (saved in the browser)
2. Tap **Add Homework** when you get an assignment
3. Follow **Today’s Plan**; check off work as you finish it
4. Ask chat to reshape the plan when time or priorities change
