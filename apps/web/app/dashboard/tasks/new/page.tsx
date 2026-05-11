import { CreateTaskClient } from '@/components/market/create-task-client';

export default function NewTaskPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <p className="font-mono text-xs uppercase text-primary">Post work</p>
        <h1 className="mt-2 font-mono text-4xl font-black uppercase">Create task</h1>
      </div>
      <CreateTaskClient />
    </div>
  );
}
