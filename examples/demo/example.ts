export type Task = {
  title: string
  done: boolean
}

export const tasks: Task[] = [
  { title: 'Create a file', done: true },
  { title: 'Save a draft', done: true },
  { title: 'Export the workspace', done: false },
]

export function progress(items: Task[]): string {
  const completed = items.filter((item) => item.done).length
  return `${completed} of ${items.length} tasks complete`
}

// Source highlighting only: BrowserOS does not execute this file.
