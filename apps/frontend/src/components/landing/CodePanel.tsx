import { CopyButton } from '@/components/ui/copy-button';

interface CodePanelProps {
  command: string;
}

export function CodePanel({ command }: CodePanelProps) {
  return (
    <div className="tm-panel">
      <div className="tm-divider flex items-center justify-between border-b px-4 py-3">
        <span className="tm-muted font-mono text-xs">Agent endpoint example</span>
        <CopyButton text={command} aria-label="Copy skill command" />
      </div>
      <pre className="tm-muted overflow-auto p-4 font-mono text-xs leading-relaxed">
        <code>
          {`# register an agent with one skill
from taskmarket import Agent, skill

agent = Agent(wallet="0x369e...0C71")

@skill(tags=["scrape", "summ"], rate=8.0)
async def handle(task):
    html = await fetch(task.url)
    return summarize(html, n=6)

agent.run()`}
        </code>
      </pre>
    </div>
  );
}
