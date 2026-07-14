import type { ReactElement, ReactNode } from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
  render,
} from 'react-email';

type RenderedEmail = {
  bodyHtml: string;
  bodyText: string;
};

type TaskmarketEmailShellProps = {
  children: ReactNode;
  preview: string;
  title: string;
  unsubscribeUrl?: string;
};

const colors = {
  accent: '#d86586',
  background: '#0d0b0f',
  border: '#342631',
  muted: '#b7aeb6',
  panel: '#171319',
  panelSoft: '#211722',
  text: '#f6f0f4',
};

const fontStack =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const monoStack = 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, ui-monospace, monospace';

function TaskmarketEmailShell({
  children,
  preview,
  title,
  unsubscribeUrl,
}: TaskmarketEmailShellProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.background,
          color: colors.text,
          fontFamily: fontStack,
          margin: 0,
          padding: '32px 12px',
        }}
      >
        <Container
          style={{
            backgroundColor: colors.panel,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '560px',
            overflow: 'hidden',
          }}
        >
          <Section style={{ padding: '28px 28px 12px' }}>
            <Text
              style={{
                color: colors.accent,
                fontFamily: monoStack,
                fontSize: '11px',
                letterSpacing: '0.12em',
                lineHeight: '16px',
                margin: '0 0 10px',
                textTransform: 'uppercase',
              }}
            >
              Taskmarket
            </Text>
            <Heading
              as="h1"
              style={{
                color: colors.text,
                fontSize: '28px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: '32px',
                margin: 0,
              }}
            >
              {title}
            </Heading>
          </Section>
          {children}
          <Section style={{ padding: '4px 28px 28px' }}>
            <Hr style={{ borderColor: colors.border, margin: '18px 0' }} />
            <Text
              style={{
                color: colors.muted,
                fontSize: '12px',
                lineHeight: '18px',
                margin: 0,
              }}
            >
              You are receiving this because you signed up for Task Drops.
              {unsubscribeUrl ? (
                <>
                  {' '}
                  <Link href={unsubscribeUrl} style={{ color: colors.muted }}>
                    Unsubscribe
                  </Link>
                  .
                </>
              ) : null}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function CtaButton({ href, label }: { href: string; label: string }) {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: colors.accent,
        borderRadius: '999px',
        color: '#170b10',
        display: 'inline-block',
        fontSize: '14px',
        fontWeight: 700,
        lineHeight: '20px',
        marginTop: '16px',
        padding: '12px 18px',
        textDecoration: 'none',
      }}
    >
      {label}
    </Button>
  );
}

export function TaskDropsWelcomeEmail({
  dashboardUrl,
  dropName,
  dropUrl,
  unsubscribeUrl,
}: {
  dashboardUrl: string;
  dropName: string;
  dropUrl: string;
  unsubscribeUrl: string;
}) {
  return (
    <TaskmarketEmailShell
      preview={`You are following ${dropName}. New work will land here as it goes live.`}
      title={`Following ${dropName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ padding: '10px 28px 8px' }}>
        <Text style={{ color: colors.muted, fontSize: '15px', lineHeight: '24px', margin: 0 }}>
          You are signed up for {dropName}. We will send new Taskmarket work from this drop as it
          goes live, with the reward, mode, tags, and a direct link to inspect the task.
        </Text>
        <CtaButton href={dropUrl} label="Open drop" />
        <CtaButton href={dashboardUrl} label="Open Taskmarket" />
      </Section>
    </TaskmarketEmailShell>
  );
}

export function TaskDropNewTaskEmail({
  description,
  dropName,
  mode,
  rewardLabel,
  tags,
  taskId,
  taskUrl,
  unsubscribeUrl,
}: {
  description: string;
  dropName: string;
  mode: string;
  rewardLabel: string;
  tags: string[];
  taskId: string;
  taskUrl: string;
  unsubscribeUrl: string;
}) {
  const tagLabel = tags.length > 0 ? tags.join(', ') : 'general';

  return (
    <TaskmarketEmailShell
      preview={`${dropName}: ${rewardLabel} ${mode} task is live on Taskmarket.`}
      title={`New task in ${dropName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ padding: '10px 28px 8px' }}>
        <Section
          style={{
            backgroundColor: colors.panelSoft,
            border: `1px solid ${colors.border}`,
            borderRadius: '10px',
            padding: '16px',
          }}
        >
          <Text
            style={{
              color: colors.accent,
              fontFamily: monoStack,
              fontSize: '11px',
              letterSpacing: '0.08em',
              lineHeight: '16px',
              margin: '0 0 10px',
              textTransform: 'uppercase',
            }}
          >
            {rewardLabel} / {mode}
          </Text>
          <Text style={{ color: colors.text, fontSize: '16px', lineHeight: '24px', margin: 0 }}>
            {description}
          </Text>
          <Hr style={{ borderColor: colors.border, margin: '16px 0' }} />
          <Text
            style={{
              color: colors.muted,
              fontFamily: monoStack,
              fontSize: '12px',
              lineHeight: '18px',
              margin: 0,
            }}
          >
            Task {taskId}
            <br />
            Tags {tagLabel}
          </Text>
        </Section>
        <CtaButton href={taskUrl} label="View task" />
      </Section>
    </TaskmarketEmailShell>
  );
}

export async function renderTaskmarketEmail(element: ReactElement): Promise<RenderedEmail> {
  const bodyHtml = await render(element);
  const bodyText = await render(element, { plainText: true });
  return { bodyHtml, bodyText };
}
