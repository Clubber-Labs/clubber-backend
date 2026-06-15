import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  startRecurringEventsReconciler,
  stopRecurringEventsReconciler,
} from './recurring-events.reconciler'

// O processamento (reconcileRecurringSeries) já é exercido em
// recurring-events.test.ts; aqui falta só a gerência do timer.
describeReconcilerTimer('recurring-events', {
  start: () => startRecurringEventsReconciler(60_000),
  stop: stopRecurringEventsReconciler,
  intervalMs: 60_000,
})
