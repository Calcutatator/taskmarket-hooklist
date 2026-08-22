'use client';

import {
  DownloadIcon,
  FileCode2Icon,
  FileJson2Icon,
  SearchIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { cloneElement, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/market/copy-button';
import {
  buildHookManifest,
  buildHookSolidity,
  hookCallbacks,
  hookModes,
  initialHookBuilderInput,
  manifestReadiness,
  type HookBuilderInput,
  type HookMode,
  type PublicHook,
} from '@/lib/hooklist';

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function HooklistDirectory({
  errorMessage,
  hasMore = false,
  hooks,
}: {
  errorMessage?: string;
  hasMore?: boolean;
  hooks: PublicHook[];
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<HookMode | 'all'>('all');
  const filtered = useMemo(
    () =>
      hooks.filter((hook) => {
        const matchesQuery = hook.address.toLowerCase().includes(query.trim().toLowerCase());
        return matchesQuery && (mode === 'all' || hook.modes.includes(mode));
      }),
    [hooks, mode, query]
  );

  return (
    <section aria-labelledby="hook-directory-heading" className="grid gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Hooklist
          </p>
          <h1
            id="hook-directory-heading"
            className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Lifecycle hooks in use
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Discover hook addresses in Taskmarket's current public-task projection. A task can
            expose one effective observed hook here; observation is not source verification, a
            security review, or a protocol-default claim.
          </p>
        </div>
        <Button asChild variant="terminal">
          <Link href="/hooks/build">Build a hook</Link>
        </Button>
      </div>
      <div className="grid gap-3 rounded-xl border border-border/58 bg-surface/34 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search hooks by address"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by deployed address"
            type="search"
            value={query}
          />
        </div>
        <div aria-label="Filter hooks by task mode" className="flex flex-wrap gap-2" role="group">
          {(['all', ...hookModes] as const).map((candidate) => (
            <Button
              key={candidate}
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              size="sm"
              type="button"
              variant={mode === candidate ? 'default' : 'outline'}
            >
              {candidate === 'all' ? 'All modes' : candidate}
            </Button>
          ))}
        </div>
      </div>
      {errorMessage ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load observed hooks</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
        </Card>
      ) : filtered.length ? (
        <div className="grid gap-3">
          {filtered.map((hook) => (
            <Card key={hook.address}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono text-base">
                    {shortAddress(hook.address)}
                  </CardTitle>
                  <Badge variant="outline">Base</Badge>
                  <Badge variant="secondary">{hook.taskCount} observed tasks</Badge>
                </div>
                <CardDescription>
                  {hook.activePhaseTaskCount} active-phase task
                  {hook.activePhaseTaskCount === 1 ? '' : 's'} reference this address.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {hook.modes.map((item) => (
                    <Badge key={item} variant="terminal">
                      {item}
                    </Badge>
                  ))}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/hooks/${hook.address}`}>Inspect hook</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No observed hooks match</CardTitle>
            <CardDescription>
              Try another address or mode. A hook only appears here after it is attached to a public
              task returned by the market API.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {!errorMessage && hasMore ? (
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          Showing the first {hooks.length} most-referenced hook addresses from this bounded public
          projection. Filters apply to these rows only; open a known address directly to inspect it.
        </p>
      ) : null}
    </section>
  );
}

function Field({ children, label }: { children: ReactElement<{ id?: string }>; label: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
    </div>
  );
}

function toggle<T extends string>(items: T[], item: T) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function download(name: string, value: string, type: string) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([value], { type }));
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function HookBuilder({
  initialInput,
  observedAddress,
}: {
  initialInput?: HookBuilderInput;
  observedAddress?: string;
}) {
  const [input, setInput] = useState<HookBuilderInput>({
    ...initialHookBuilderInput,
    ...initialInput,
    ...(observedAddress ? { hookAddress: observedAddress } : {}),
  });
  const readiness = manifestReadiness(input);
  const manifest = JSON.stringify(buildHookManifest(input), null, 2);
  const solidity = buildHookSolidity(input);
  const update = <K extends keyof HookBuilderInput>(key: K, value: HookBuilderInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const preview = (
    label: string,
    content: string,
    icon: ReactNode,
    filename: string,
    type: string
  ) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{label}</CardTitle>
            <CardDescription>Generated locally from this form.</CardDescription>
          </div>
          <div className="flex gap-2">
            <CopyButton icon={icon} label={`Copy ${label}`} text={content} />
            <Button
              aria-label={`Download ${label}`}
              onClick={() => download(filename, content, type)}
              size="icon-xs"
              type="button"
              variant="terminal"
            >
              <DownloadIcon />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <pre
          aria-label={`${label} preview`}
          className="max-h-96 overflow-auto rounded-lg border border-border/58 bg-background/52 p-4 text-xs leading-5 text-foreground"
          tabIndex={0}
        >
          <code>{content}</code>
        </pre>
      </CardContent>
    </Card>
  );

  return (
    <section aria-labelledby="hook-builder-heading" className="grid gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Hooklist builder
          </p>
          <h1
            id="hook-builder-heading"
            className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Create an evidence-backed hook package
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Generate a fail-closed Solidity scaffold and versioned manifest. Every selected callback
            reverts until you implement its policy, and the manifest remains a draft until every
            deployment and trust declaration is entered and reviewed.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hooks">Back to discovery</Link>
        </Button>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Identity and source</CardTitle>
              <CardDescription>
                These fields identify a specific source revision; a branch name is not enough.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Hook name">
                <Input
                  onChange={(event) => update('name', event.target.value)}
                  value={input.name}
                />
              </Field>
              <Field label="Author">
                <Input
                  onChange={(event) => update('author', event.target.value)}
                  value={input.author}
                />
              </Field>
              <Field label="Description">
                <Textarea
                  className="sm:col-span-2"
                  onChange={(event) => update('description', event.target.value)}
                  value={input.description}
                />
              </Field>
              <Field label="Author HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('authorUrl', event.target.value)}
                  value={input.authorUrl}
                />
              </Field>
              <Field label="Source repository HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('repository', event.target.value)}
                  value={input.repository}
                />
              </Field>
              <Field label="Git commit SHA">
                <Input
                  onChange={(event) => update('commit', event.target.value)}
                  value={input.commit}
                />
              </Field>
              <Field label="Contract path">
                <Input
                  onChange={(event) => update('sourcePath', event.target.value)}
                  placeholder="src/MyHook.sol"
                  value={input.sourcePath}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Callbacks and modes</CardTitle>
              <CardDescription>
                Choose only lifecycle points your implementation will actually enforce or observe.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {hookCallbacks.map(([callback, description]) => (
                  <label
                    className="flex cursor-pointer gap-3 rounded-lg border border-border/58 p-3 text-sm"
                    key={callback}
                  >
                    <Checkbox
                      checked={input.callbacks.includes(callback)}
                      onCheckedChange={() => update('callbacks', toggle(input.callbacks, callback))}
                    />
                    <span>
                      <span className="block font-mono font-semibold text-foreground">
                        {callback}
                      </span>
                      <span className="mt-1 block leading-5 text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {hookModes.map((mode) => (
                  <Button
                    aria-pressed={input.modes.includes(mode)}
                    key={mode}
                    onClick={() => update('modes', toggle(input.modes, mode))}
                    size="sm"
                    type="button"
                    variant={input.modes.includes(mode) ? 'default' : 'outline'}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Deployment and hook data</CardTitle>
              <CardDescription>
                Use measured, chain-specific values. Empty or zero hashes cannot become
                publish-ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Taskmarket Diamond address">
                <Input
                  onChange={(event) => update('taskmarket', event.target.value)}
                  value={input.taskmarket}
                />
              </Field>
              <Field label="Deployed hook address">
                <Input
                  onChange={(event) => update('hookAddress', event.target.value)}
                  value={input.hookAddress}
                />
              </Field>
              <Field label="Deployment transaction hash">
                <Input
                  onChange={(event) => update('deploymentTransactionHash', event.target.value)}
                  value={input.deploymentTransactionHash}
                />
              </Field>
              <Field label="Deployment block number">
                <Input
                  inputMode="numeric"
                  onChange={(event) => update('deploymentBlockNumber', event.target.value)}
                  value={input.deploymentBlockNumber}
                />
              </Field>
              <Field label="Runtime code hash">
                <Input
                  onChange={(event) => update('runtimeCodehash', event.target.value)}
                  value={input.runtimeCodehash}
                />
              </Field>
              <Field label="hookData encoding">
                <select
                  aria-label="hookData encoding"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) =>
                    update(
                      'hookDataEncoding',
                      event.target.value as HookBuilderInput['hookDataEncoding']
                    )
                  }
                  value={input.hookDataEncoding}
                >
                  <option value="none">No configuration</option>
                  <option value="abi">ABI encoded</option>
                </select>
              </Field>
              {input.hookDataEncoding === 'abi' ? (
                <>
                  <p className="text-sm leading-5 text-muted-foreground sm:col-span-2">
                    ABI examples are publisher-attested structural examples. Enter one parameter
                    directly in JSON, or a positional JSON array for multiple parameters. Integers
                    use decimal strings; named tuples use objects. Supplied bytes must decode,
                    re-encode canonically, and match that JSON. This is not source, deployment, or
                    independent conformance verification.
                  </p>
                  <Field label="ABI parameters">
                    <Input
                      onChange={(event) => update('hookDataAbiType', event.target.value)}
                      placeholder="(address recipient, uint256 limit) config"
                      value={input.hookDataAbiType}
                    />
                  </Field>
                  <Field label="Encoded bytes">
                    <Input
                      onChange={(event) => update('hookDataEncoded', event.target.value)}
                      value={input.hookDataEncoded}
                    />
                  </Field>
                  <Field label="Decoded JSON example">
                    <Textarea
                      className="sm:col-span-2"
                      onChange={(event) => update('hookDataDecoded', event.target.value)}
                      placeholder='{"limit":"100","recipient":"0x..."}'
                      value={input.hookDataDecoded}
                    />
                  </Field>
                </>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Upgradeability and gas</CardTitle>
              <CardDescription>
                Proxy metadata and gas limits are safety data, not cosmetic fields.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Deployment type">
                <select
                  aria-label="Deployment type"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) =>
                    update(
                      'upgradeability',
                      event.target.value as HookBuilderInput['upgradeability']
                    )
                  }
                  value={input.upgradeability}
                >
                  <option value="immutable">Immutable</option>
                  <option value="erc1967">ERC-1967 proxy</option>
                </select>
              </Field>
              <Field label="Typical callback gas">
                <Input
                  inputMode="numeric"
                  onChange={(event) => update('typicalGas', event.target.value)}
                  value={input.typicalGas}
                />
              </Field>
              <Field label="Maximum callback gas">
                <Input
                  inputMode="numeric"
                  onChange={(event) => update('maximumGas', event.target.value)}
                  value={input.maximumGas}
                />
              </Field>
              <Field label="Gas methodology">
                <Input
                  onChange={(event) => update('gasMethodology', event.target.value)}
                  placeholder="Foundry gas snapshot, Base fork"
                  value={input.gasMethodology}
                />
              </Field>
              {input.upgradeability === 'erc1967' ? (
                <>
                  <Field label="Implementation address">
                    <Input
                      onChange={(event) => update('proxyImplementation', event.target.value)}
                      value={input.proxyImplementation}
                    />
                  </Field>
                  <Field label="Proxy admin address">
                    <Input
                      onChange={(event) => update('proxyAdmin', event.target.value)}
                      value={input.proxyAdmin}
                    />
                  </Field>
                  <Field label="Upgrade authority description">
                    <Textarea
                      className="sm:col-span-2"
                      onChange={(event) =>
                        update('upgradeAuthorityDescription', event.target.value)
                      }
                      value={input.upgradeAuthorityDescription}
                    />
                  </Field>
                </>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Trust declarations</CardTitle>
              <CardDescription>
                Do not use this form to infer source verification, listing, security, liveness,
                dependencies, roles, conformance, or protocol-default status.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Source verification">
                <select
                  aria-label="Source verification"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) => update('sourceVerification', event.target.value)}
                  value={input.sourceVerification}
                >
                  <option value="">Select after verification</option>
                  <option value="verified">Verified</option>
                  <option value="partially-verified">Partially verified</option>
                  <option value="unverified">Unverified</option>
                  <option value="not-applicable">Not applicable</option>
                </select>
              </Field>
              <Field label="Listing status">
                <select
                  aria-label="Listing status"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) => update('listingStatus', event.target.value)}
                  value={input.listingStatus}
                >
                  <option value="">Select current status</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="submitted">Submitted</option>
                  <option value="listed">Listed</option>
                  <option value="delisted">Delisted</option>
                </select>
              </Field>
              <Field label="Listing evidence HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('listingEvidenceUrl', event.target.value)}
                  value={input.listingEvidenceUrl}
                />
              </Field>
              <Field label="Verifier evidence JSON array">
                <Textarea
                  className="sm:col-span-2"
                  onChange={(event) => update('sourceVerificationVerifiers', event.target.value)}
                  placeholder='[{"chainId":8453,"url":"https://basescan.org/address/...","status":"verified"}]'
                  value={input.sourceVerificationVerifiers}
                />
              </Field>
              <Field label="Conformance status">
                <select
                  aria-label="Conformance status"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) => update('conformanceStatus', event.target.value)}
                  value={input.conformanceStatus}
                >
                  <option value="">Select evidence level</option>
                  <option value="not-claimed">Not claimed</option>
                  <option value="self-attested">Self-attested</option>
                  <option value="tested">Tested</option>
                  <option value="independently-verified">Independently verified</option>
                </select>
              </Field>
              <Field label="Conformance evidence HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('conformanceEvidenceUrl', event.target.value)}
                  value={input.conformanceEvidenceUrl}
                />
              </Field>
              <Field label="Protocol-default status">
                <select
                  aria-label="Protocol-default status"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) => update('protocolDefaultStatus', event.target.value)}
                  value={input.protocolDefaultStatus}
                >
                  <option value="">Select observed status</option>
                  <option value="not-default">Not default</option>
                  <option value="candidate">Candidate</option>
                </select>
              </Field>
              <Field label="Protocol-default evidence HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('protocolDefaultEvidenceUrl', event.target.value)}
                  value={input.protocolDefaultEvidenceUrl}
                />
              </Field>
              <Field label="Liveness requirements JSON array">
                <Textarea
                  onChange={(event) => update('livenessRequirements', event.target.value)}
                  value={input.livenessRequirements}
                />
              </Field>
              <Field label="Liveness failure mode">
                <Textarea
                  onChange={(event) => update('livenessFailureMode', event.target.value)}
                  value={input.livenessFailureMode}
                />
              </Field>
              <Field label="Recovery procedure">
                <Textarea
                  onChange={(event) => update('livenessRecovery', event.target.value)}
                  value={input.livenessRecovery}
                />
              </Field>
              <Field label="Security notes">
                <Textarea
                  onChange={(event) => update('securityNotes', event.target.value)}
                  value={input.securityNotes}
                />
              </Field>
              <Field label="Security audit status">
                <select
                  aria-label="Security audit status"
                  className="h-10 rounded-full border border-input/78 bg-background/42 px-4 text-sm text-foreground"
                  onChange={(event) => update('securityAuditStatus', event.target.value)}
                  value={input.securityAuditStatus}
                >
                  <option value="">Select audit status</option>
                  <option value="unaudited">Unaudited</option>
                  <option value="in-progress">In progress</option>
                  <option value="audited">Audited</option>
                </select>
              </Field>
              <Field label="Security audit scope">
                <Input
                  onChange={(event) => update('securityAuditScope', event.target.value)}
                  value={input.securityAuditScope}
                />
              </Field>
              <Field label="Security audit report HTTPS URL">
                <Input
                  inputMode="url"
                  onChange={(event) => update('securityAuditReport', event.target.value)}
                  value={input.securityAuditReport}
                />
              </Field>
              <Field label="Security audit date">
                <Input
                  onChange={(event) => update('securityAuditDate', event.target.value)}
                  placeholder="YYYY-MM-DD"
                  value={input.securityAuditDate}
                />
              </Field>
              <Field label="External dependencies JSON array">
                <Textarea
                  onChange={(event) => update('externalDependencies', event.target.value)}
                  value={input.externalDependencies}
                />
              </Field>
              <Field label="Privileged roles JSON array">
                <Textarea
                  className="sm:col-span-2"
                  onChange={(event) => update('privilegedRoles', event.target.value)}
                  value={input.privilegedRoles}
                />
              </Field>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border/58 p-3 text-sm sm:col-span-2">
                <Checkbox
                  checked={input.trustReviewed}
                  onCheckedChange={(checked) => update('trustReviewed', checked === true)}
                />
                <span className="leading-5 text-muted-foreground">
                  I reviewed these declarations against current evidence. I understand this does not
                  publish, list, verify, audit, or select the hook as a protocol default.
                </span>
              </label>
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Publish after independent review</CardTitle>
              <CardDescription>
                Replace every fail-closed callback stub, download both files, compile the scaffold
                against the installed contracts package, and run the manifest validator before
                submitting the repository and deployment evidence through the public listing
                process.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className={readiness.ready ? 'border-success/46' : 'border-warning/46'}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldAlertIcon aria-hidden="true" className="size-5 text-warning" />
                <CardTitle>{readiness.ready ? 'Evidence complete' : 'Draft scaffold'}</CardTitle>
              </div>
              <CardDescription>
                {readiness.ready
                  ? 'The manifest has required evidence fields. Validate it and independently review each assertion before submitting.'
                  : 'This output is intentionally marked x-draft and cannot be treated as publish-ready.'}
              </CardDescription>
            </CardHeader>
            {!readiness.ready ? (
              <CardContent>
                <ul className="grid gap-1 text-sm text-muted-foreground">
                  {readiness.missing.slice(0, 10).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {readiness.missing.length > 10 ? (
                    <li>and {readiness.missing.length - 10} more</li>
                  ) : null}
                </ul>
              </CardContent>
            ) : null}
          </Card>
          {preview(
            'taskmarket-hook.json',
            manifest,
            <FileJson2Icon />,
            'taskmarket-hook.json',
            'application/json'
          )}
          {preview(
            'Solidity scaffold',
            solidity,
            <FileCode2Icon />,
            'MyTaskmarketHook.sol',
            'text/plain'
          )}
        </div>
      </div>
    </section>
  );
}

export function HookInspection({
  errorMessage,
  hook,
}: {
  errorMessage?: string;
  hook: PublicHook | null;
}) {
  if (errorMessage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load this hook</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/hooks">Return to Hooklist</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!hook)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hook not found in the public feed</CardTitle>
          <CardDescription>
            This address was not returned by the current public task projection. It may be private
            or not currently referenced by a public task.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/hooks">Return to Hooklist</Link>
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <section aria-labelledby="hook-inspection-heading" className="grid gap-5">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Observed hook
        </p>
        <h1
          id="hook-inspection-heading"
          className="mt-2 break-all font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        >
          {hook.address}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          This record is derived from public task references. It does not make claims about the
          hook’s source, proxy, privileged roles, security posture, liveness, conformance, listing,
          or protocol-default status.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Usage on Taskmarket</CardTitle>
          <CardDescription>
            {hook.taskCount} observed tasks, including {hook.activePhaseTaskCount} in the active
            lifecycle phase. Review, appeal, dispute, and expired-awaiting-settlement tasks are
            excluded from this count.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {hook.modes.map((mode) => (
              <Badge key={mode} variant="terminal">
                {mode}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {hook.taskIds.slice(0, 8).map((taskId) => (
              <Button asChild key={taskId} size="sm" variant="outline">
                <Link href={`/tasks/${taskId}`}>View task {taskId.slice(2, 8)}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Button asChild className="w-fit" variant="terminal">
        <Link href={`/hooks/build?address=${encodeURIComponent(hook.address)}`}>
          Configure a manifest from this address
        </Link>
      </Button>
    </section>
  );
}
