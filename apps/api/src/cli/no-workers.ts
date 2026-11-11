// Imported first by CLI scripts: background workers must never start in a one-off command.
process.env.RUN_WORKERS = 'false';
