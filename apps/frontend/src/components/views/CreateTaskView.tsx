import { CreateTaskForm } from '../CreateTaskForm';
import { PageLayout } from '../layout/PageLayout';
import { PageHeader } from '../layout/PageHeader';

export function CreateTaskView() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Create a Task"
          description="Post a new task and let workers compete to complete it. Choose the mode that best fits your needs."
        />

        <CreateTaskForm />
      </div>
    </PageLayout>
  );
}
