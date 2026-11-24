export type Task =
  | { kind: 'upper'; input: string }
  | { kind: 'lower'; input: string }
  | { kind: 'reverse'; input: string }
  | { kind: 'word_count'; input: string }
  | { kind: 'sum_numbers'; input: number[] }
  | { kind: 'max_number'; input: number[] }
  | { kind: 'palindrome'; input: string }
  | { kind: 'slugify'; input: string };

export function solveTask(task: Task): string | number | boolean {
  switch (task.kind) {
    case 'upper':
      return task.input.toUpperCase();
    case 'lower':
      return task.input.toLowerCase();
    case 'reverse':
      return [...task.input].reverse().join('');
    case 'word_count':
      return task.input.trim() ? task.input.trim().split(/\s+/).length : 0;
    case 'sum_numbers':
      return task.input.reduce((total, value) => total + value, 0);
    case 'max_number':
      return task.input.reduce((max, value) => (value > max ? value : max), 0);
    case 'palindrome': {
      const normalized = task.input.toLowerCase().replace(/\s+/g, '');
      return normalized === [...normalized].reverse().join('');
    }
    case 'slugify':
      return task.input
        .trim()
        .toLowerCase()
        .replace(/[^a-z]+/g, '-')
        .replace(/^-|-$/g, '');
  }
}
