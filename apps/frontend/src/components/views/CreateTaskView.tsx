import { CreateTaskForm } from '../CreateTaskForm';
import { PageLayout } from '../layout/PageLayout';

export function CreateTaskView() {
  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="font-heading text-3xl font-bold mb-1">Create a Task</h1>
          <p className="text-text-secondary text-sm">
            Post a new task and let workers compete to complete it. Choose the mode that best fits
            your needs.
          </p>
        </div>

        <CreateTaskForm />
      </div>
    </PageLayout>
  );
}
