// storybook-coverage: components/ui/avatar.tsx
// storybook-coverage: components/ui/badge.tsx
// storybook-coverage: components/ui/breadcrumb.tsx
// storybook-coverage: components/ui/button-group.tsx
// storybook-coverage: components/ui/button.tsx
// storybook-coverage: components/ui/card.tsx
// storybook-coverage: components/ui/checkbox.tsx
// storybook-coverage: components/ui/dialog.tsx
// storybook-coverage: components/ui/drawer.tsx
// storybook-coverage: components/ui/dropdown-menu.tsx
// storybook-coverage: components/ui/input.tsx
// storybook-coverage: components/ui/label.tsx
// storybook-coverage: components/ui/native-select.tsx
// storybook-coverage: components/ui/pagination.tsx
// storybook-coverage: components/ui/popover.tsx
// storybook-coverage: components/ui/scroll-area.tsx
// storybook-coverage: components/ui/select.tsx
// storybook-coverage: components/ui/separator.tsx
// storybook-coverage: components/ui/sheet.tsx
// storybook-coverage: components/ui/skeleton.tsx
// storybook-coverage: components/ui/switch.tsx
// storybook-coverage: components/ui/table.tsx
// storybook-coverage: components/ui/tabs.tsx
// storybook-coverage: components/ui/textarea.tsx
// storybook-coverage: components/ui/toggle-group.tsx
// storybook-coverage: components/ui/toggle.tsx
// storybook-coverage: components/ui/tooltip.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bell, Bold, Italic, MoreHorizontal, Plus, Search } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function PrimitiveCatalog() {
  return <div>Taskmarket primitives</div>;
}

const meta = {
  component: PrimitiveCatalog,
  parameters: {
    docs: {
      description: {
        component:
          'The complete low-level Taskmarket component set. Stories use semantic design tokens and include compound, interactive, disabled, and boundary states. Buttons use height-proportional squircle corners while retaining each semantic color variant.',
      },
    },
  },
  title: 'Primitives/Catalog',
} satisfies Meta<typeof PrimitiveCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const buttonVariants = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'link',
  'destructive',
  'terminal',
  'chip',
] as const;

export const Buttons: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {buttonVariants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button aria-label="Add task" size="icon">
          <Plus />
        </Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="taskdrop-theme grid gap-3 rounded-lg bg-drop-hero p-5">
        <p className="text-sm font-medium text-drop-hero-foreground">Task Drop controls</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="taskdrop-primary">Primary</Button>
          <Button variant="taskdrop-accent">Accent</Button>
          <Button variant="taskdrop-outline">Outline</Button>
        </div>
      </div>
      <div className="grid justify-start gap-3">
        <p className="text-sm font-medium text-muted-foreground">Grouped actions</p>
        <ButtonGroup>
          <Button variant="outline">Back</Button>
          <Button variant="outline">Save draft</Button>
          <Button>Publish</Button>
        </ButtonGroup>
      </div>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(
        [
          'default',
          'secondary',
          'destructive',
          'outline',
          'ghost',
          'link',
          'terminal',
          'success',
          'warning',
        ] as const
      ).map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

export const Avatars: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <Avatar className="size-14">
        <AvatarImage alt="Ada agent" src="https://github.com/shadcn.png" />
        <AvatarFallback>AD</AvatarFallback>
        <AvatarBadge />
      </Avatar>
      <Avatar className="size-10">
        <AvatarFallback>TM</AvatarFallback>
      </Avatar>
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>AE</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>BK</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>CL</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+12</AvatarGroupCount>
      </AvatarGroup>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-5 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Content moderation agent</CardTitle>
          <CardDescription>Short title and one-line description.</CardDescription>
          <CardAction>
            <Badge>Open</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Review 250 product images for policy compliance.
          </p>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="font-mono text-sm">$125.00</span>
          <Button size="sm">View task</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Empty card</CardTitle>
          <CardDescription>No optional action, content, or footer data.</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Extremely long card title that verifies the component wraps dense marketplace data
            without clipping
          </CardTitle>
          <CardDescription>
            A deliberately long description covering multiple lines and representative user-provided
            content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="break-all font-mono text-xs text-muted-foreground">
            0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
          </p>
        </CardContent>
      </Card>
    </div>
  ),
};

export const FormControls: Story = {
  render: () => (
    <form className="grid max-w-lg gap-5" onSubmit={(event) => event.preventDefault()}>
      <div className="grid gap-2">
        <Label htmlFor="task-title">Task title</Label>
        <Input id="task-title" placeholder="Describe the outcome" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <Textarea id="task-description" placeholder="Include acceptance criteria" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="task-mode">Mode</Label>
        <NativeSelect defaultValue="bounty" id="task-mode">
          <option value="bounty">Bounty</option>
          <option value="auction">Auction</option>
          <option value="competition">Competition</option>
        </NativeSelect>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="terms" />
        <Label htmlFor="terms">I accept the task terms</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="private" />
        <Label htmlFor="private">Private task</Label>
      </div>
      <Input aria-invalid defaultValue="Invalid reward" />
      <Input disabled value="Disabled field" readOnly />
    </form>
  ),
};

export const SelectMenu: Story = {
  render: () => (
    <Select defaultValue="open">
      <SelectTrigger className="w-64" aria-label="Task status">
        <SelectValue placeholder="Choose a status" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Active</SelectLabel>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="in_progress">In progress</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Terminal</SelectLabel>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const TabsAndToggles: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-8">
      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger disabled value="review">
            Review
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity">Latest task activity</TabsContent>
        <TabsContent value="submissions">Three submissions</TabsContent>
        <TabsContent value="review">Review unavailable</TabsContent>
      </Tabs>
      <Tabs defaultValue="week">
        <TabsList variant="line">
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="day">Day view</TabsContent>
        <TabsContent value="week">Week view</TabsContent>
        <TabsContent value="month">Month view</TabsContent>
      </Tabs>
      <div className="flex gap-3">
        <Toggle aria-label="Toggle bold">
          <Bold />
        </Toggle>
        <Toggle aria-label="Toggle italic" variant="outline">
          <Italic />
        </Toggle>
        <ToggleGroup aria-label="Text style" type="multiple" variant="outline">
          <ToggleGroupItem aria-label="Toggle bold" value="bold">
            <Bold />
          </ToggleGroupItem>
          <ToggleGroupItem aria-label="Toggle italic" value="italic">
            <Italic />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  ),
};

export const BreadcrumbsAndPagination: Story = {
  render: () => (
    <div className="grid gap-10">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/tasks">Tasks</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Task 4821</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#">1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink isActive href="#">
              2
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  ),
};

export const DataTable: Story = {
  render: () => (
    <Table>
      <TableCaption>Recent task settlements</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Reward</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Dataset evaluation</TableCell>
          <TableCell>Completed</TableCell>
          <TableCell className="text-right">$450.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Landing page audit</TableCell>
          <TableCell>In review</TableCell>
          <TableCell className="text-right">$120.00</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>Total</TableCell>
          <TableCell className="text-right">$570.00</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};

export const ScrollAndLoading: Story = {
  render: () => (
    <div className="grid max-w-xl gap-6">
      <ScrollArea className="h-48 rounded-lg border border-border/58 p-4">
        {Array.from({ length: 20 }, (_, index) => (
          <p key={index} className="border-b border-border/36 py-2 text-sm">
            Activity item {index + 1}
          </p>
        ))}
      </ScrollArea>
      <Separator />
      <div aria-busy="true" aria-label="Loading task card" className="grid gap-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>
    </div>
  ),
};

export const TooltipAndPopover: Story = {
  render: () => (
    <div className="flex gap-4">
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button aria-label="Notifications" size="icon" variant="outline">
            <Bell />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Filter tasks</Button>
        </PopoverTrigger>
        <PopoverContent className="grid gap-3">
          <Label htmlFor="search-tasks">Search</Label>
          <div className="relative">
            <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input className="pl-9" id="search-tasks" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

const menuAction = fn();

export const Dropdown: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Open task menu" size="icon" variant="outline">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Task actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={menuAction}>
            Open details
            <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Watch updates</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="public">
          <DropdownMenuRadioItem value="public">Public</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="private">Private</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Open task menu' }));
    await userEvent.click(await within(document.body).findByText('Open details'));
    await expect(menuAction).toHaveBeenCalled();
  },
};

export const DialogModal: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Cancel task</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this task?</DialogTitle>
          <DialogDescription>
            This action returns the remaining reward to the requester.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Keep task</Button>
          <Button variant="destructive">Cancel task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const DrawerAndSheet: Story = {
  render: () => (
    <div className="flex gap-3">
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="outline">Open mobile filters</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter tasks</DrawerTitle>
            <DrawerDescription>Narrow the marketplace by status and task mode.</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button>Apply filters</Button>
            <DrawerClose asChild>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">Open task details</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Task details</SheetTitle>
            <SheetDescription>Review requirements before accepting the task.</SheetDescription>
          </SheetHeader>
          <div className="px-4 text-sm text-muted-foreground">Reward: $250.00</div>
          <SheetFooter>
            <Button>Accept task</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  ),
};
