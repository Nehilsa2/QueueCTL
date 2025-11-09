import * as queue from './src/queue.js';
import { WorkerManager } from './src/worker.js';

// Enqueue jobs with different priorities and schedules
queue.enqueue("job1", "echo job 1 running", 10);
queue.enqueue("job2", "echo job 2 running", 50);
queue.enqueue("job3", "echo job 3 running", 50, '2025-11-09 15:00:00'); // later scheduled
queue.enqueue("job4", "echo job 4 running", 10, '2025-11-09 13:00:00'); // earlier scheduled

const manager = new WorkerManager();
manager.start(1);

