# Finish Line Friend

A calm study and homework planning partner for students.

## Features

- **Setup screen** — name, class schedule (period + optional teacher), homework availability, commitments
- **Add Homework form** — class dropdown, dates, type, time, difficulty; reading fields + paste/upload
- **Today’s Plan** — personalized schedule with visible reading/comprehension gates
- **Comprehension gates** — reading complete ≠ assignment complete; Pending / Passed / Review needed
- **Chat** — for “what’s next?”, “I’m behind”, checkpoints, etc. (not for entering classes/homework)
- **Focus Music** — optional local calm tone (off by default, no autoplay)
- Progress meter and points

## Run

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Flow

1. Complete the setup form once (saved in the browser)
2. Tap **Add Homework** when you get an assignment
3. Follow **Today’s Plan**; use chat for questions and reading checkpoints
