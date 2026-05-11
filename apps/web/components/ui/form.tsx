'use client';

import * as React from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

const FormItemContext = React.createContext<{ id: string }>({ id: '' });

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    descriptionId: `${id}-form-item-description`,
    errorId: `${id}-form-item-message`,
    formItemId: `${id}-form-item`,
    id,
    name: fieldContext.name,
    ...fieldState,
  };
}

function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn('grid gap-2', className)} data-slot="form-item" {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      className={cn(error && 'text-destructive', className)}
      data-slot="form-label"
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, errorId, formItemId } = useFormField();

  return (
    <Slot.Root
      aria-describedby={error ? errorId : undefined}
      aria-invalid={!!error}
      data-slot="form-control"
      id={formItemId}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId } = useFormField();

  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      data-slot="form-description"
      id={descriptionId}
      {...props}
    />
  );
}

function FormMessage({ children, className, ...props }: React.ComponentProps<'p'>) {
  const { error, errorId } = useFormField();
  const body = error ? String(error?.message ?? '') : children;

  if (!body) {
    return null;
  }

  return (
    <p
      className={cn('font-mono text-sm text-destructive', className)}
      data-slot="form-message"
      id={errorId}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
