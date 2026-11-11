import { fold } from './subscribers'
import { toLatinDigits } from '../../lib/phone'
import { taskAssignees, isSharedTask, taskStatusInfo, type Task } from './model'
export const taskSearchText = (text: string) => fold(toLatinDigits(text)).toLocaleLowerCase()
export function searchableTask(
  task: Task,
  names: { people: Map<string, string>; types: Map<number, string>; zones: Map<number, string> },
): string {
  return taskSearchText(
    [
      `مهمة رقم #${task.number}`,
      task.subscriberName,
      task.subscriberPhone,
      task.details,
      task.completionNotes,
      task.cancelReason,
      task.location,
      names.types.get(task.typeId),
      task.zoneId ? names.zones.get(task.zoneId) : '',
      ...taskAssignees(task).map((id) => names.people.get(id)),
      isSharedTask(task) ? 'مهمة مشتركة' : '',
      taskStatusInfo[task.status]?.label,
      task.status === 'done' ? 'منجزة' : '',
    ].join(' '),
  )
}
export function matchesTask(task: Task, query: string, names: Parameters<typeof searchableTask>[1]): boolean {
  const text = searchableTask(task, names)
  return taskSearchText(query)
    .split(' ')
    .filter(Boolean)
    .every((word) => text.includes(word))
}
