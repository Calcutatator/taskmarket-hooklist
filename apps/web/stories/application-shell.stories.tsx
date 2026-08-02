// storybook-coverage: components/animated-taskmarket-logo.tsx
// storybook-coverage: components/app-sidebar.tsx
// storybook-coverage: components/dashboard-breadcrumb.tsx
// storybook-coverage: components/dashboard-loading.tsx
// storybook-coverage: components/legal-document-page.tsx
// storybook-coverage: components/market/first-run-checklist.tsx
// storybook-coverage: components/nav-documents.tsx
// storybook-coverage: components/nav-main.tsx
// storybook-coverage: components/nav-secondary.tsx
// storybook-coverage: components/nav-user.tsx
// storybook-coverage: components/privy-account-control.tsx
// storybook-coverage: components/public-site-footer.tsx
// storybook-coverage: components/public-site-header.tsx
// storybook-coverage: components/section-cards.tsx
// storybook-coverage: components/site-header.tsx
// storybook-coverage: components/ui/form.tsx
// storybook-coverage: components/ui/sidebar.tsx
// storybook-coverage: components/ui/sonner.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { AnimatedTaskmarketLogo } from '@/components/animated-taskmarket-logo';
import { AppSidebar } from '@/components/app-sidebar';
import { DashboardBreadcrumb } from '@/components/dashboard-breadcrumb';
import {
  AccountLoading,
  AgentProfileLoading,
  DashboardConsoleLoading,
  DashboardOverviewLoading,
  DirectoryLoading,
  InboxLoading,
  LeaderboardLoading,
  NewTaskLoading,
  TaskDetailLoading,
  TaskDropDirectoryLoading,
  TaskListLoading,
} from '@/components/dashboard-loading';
import { LegalDocumentPage } from '@/components/legal-document-page';
import { PublicSiteFooter } from '@/components/public-site-footer';
import { PublicSiteHeader } from '@/components/public-site-header';
import { SectionCards } from '@/components/section-cards';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';

function ApplicationCatalog() {
  return <div>Taskmarket application shell</div>;
}

const meta = {
  component: ApplicationCatalog,
  title: 'Patterns/Application shell',
} satisfies Meta<typeof ApplicationCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrandLockup: Story = {
  render: () => (
    <div className="grid min-h-72 place-items-center rounded-lg border border-border/58 bg-surface/58 p-8">
      <AnimatedTaskmarketLogo className="w-72" />
    </div>
  ),
};

export const DashboardShell: Story = {
  render: () => (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="grid gap-6 p-6">
          <DashboardBreadcrumb />
          <SectionCards
            activeAgentCount={84}
            agentCount={512}
            agentsTrend={{ delta: { value: 12 }, sparkline: [31, 38, 42, 45, 49, 51] }}
            openTaskCount={18}
            openTasksTrend={{ delta: { direction: 'down', value: -4 } }}
            rewardsTrend={{ delta: { value: 22 }, sparkline: [12, 18, 17, 24, 31, 38] }}
            taskCount={425}
            tasksTrend={{ delta: { value: 18 }, sparkline: [8, 12, 9, 16, 22, 27] }}
            totalRewards="1284000000000"
          />
        </main>
      </SidebarInset>
    </SidebarProvider>
  ),
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/dashboard/tasks/0xabc123' } },
    viewport: { defaultViewport: 'desktop' },
  },
};

export const PublicSiteChrome: Story = {
  render: () => (
    <div className="-m-6 flex min-h-screen flex-col">
      <PublicSiteHeader />
      <main className="grid min-h-96 flex-1 place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Public page content
          </h1>
          <p className="mt-3 text-muted-foreground">Header and footer at their real page widths.</p>
        </div>
      </main>
      <PublicSiteFooter
        stats={{ agentCount: 512, taskCount: 425, totalRewards: '1284000000000' }}
      />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktop' },
  },
};

export const MarketplaceMetricsBoundaries: Story = {
  render: () => (
    <div className="grid gap-8">
      <SectionCards openTaskCount={0} taskCount={0} totalRewards="0" />
      <SectionCards
        activeAgentCount={999999}
        agentCount={12345678}
        openTaskCount={12000}
        taskCount={987654321}
        totalRewards="999999999999999999"
      />
    </div>
  ),
};

type ExampleForm = { taskTitle: string };

function ValidatedForm() {
  const form = useForm<ExampleForm>({ defaultValues: { taskTitle: '' } });
  return (
    <Form {...form}>
      <form
        className="grid max-w-lg gap-5"
        onSubmit={form.handleSubmit(() => toast.success('Task draft saved'))}
      >
        <FormField
          control={form.control}
          name="taskTitle"
          rules={{
            minLength: { message: 'Use at least 12 characters.', value: 12 },
            required: 'Title is required.',
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Task title</FormLabel>
              <FormControl>
                <Input placeholder="Describe the outcome" {...field} />
              </FormControl>
              <FormDescription>This becomes the task card headline.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Save draft</Button>
      </form>
      <Toaster />
    </Form>
  );
}

export const ValidatedFormAndToast: Story = {
  render: () => <ValidatedForm />,
};

export const LegalDocument: Story = {
  render: () => <LegalDocumentPage type="terms_of_service" />,
};

export const DashboardLoadingStates: Story = {
  render: () => (
    <div className="grid gap-12">
      <section aria-label="Console loading">
        <DashboardConsoleLoading />
      </section>
      <section aria-label="Overview loading">
        <DashboardOverviewLoading />
      </section>
      <section aria-label="Task list loading">
        <TaskListLoading />
      </section>
      <section aria-label="Task detail loading">
        <TaskDetailLoading />
      </section>
      <section aria-label="New task loading">
        <NewTaskLoading />
      </section>
      <section aria-label="Directory loading">
        <DirectoryLoading />
      </section>
      <section aria-label="Task Drop directory loading">
        <TaskDropDirectoryLoading />
      </section>
      <section aria-label="Leaderboard loading">
        <LeaderboardLoading />
      </section>
      <section aria-label="Agent profile loading">
        <AgentProfileLoading />
      </section>
      <section aria-label="Account loading">
        <AccountLoading />
      </section>
      <section aria-label="Inbox loading">
        <InboxLoading />
      </section>
    </div>
  ),
  parameters: {
    a11y: { test: 'todo' },
  },
};
