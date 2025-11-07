queuectl/                     <-- root
├─ package.json
├─ README.md
├─ src/
│  ├─ cli.js                 <-- entrypoint (yargs)
│  ├─ db.js                  <-- sqlite wrapper
│  ├─ queue.js               <-- queue actions (enqueue, list, dlq, retry)
│  ├─ worker.js              <-- worker manager & worker loop
│  ├─ config.js              <-- simple config management (persisted)
│  └─ utils.js               <-- helpers (time, sleep, uuid)
├─ scripts/
│  └─ demo.sh                <-- demo/test script to exercise flows
└─ data/
   └─ queue.sqlite           <-- created at runtime
