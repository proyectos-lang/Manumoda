'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * `sinContenedor` quita el div que envuelve la tabla.
 *
 * POR QUE HACE FALTA:
 *   Ese div lleva `overflow-x-auto`, y un elemento con overflow crea su
 *   propio contexto de scroll. Un `<thead className="sticky top-0">` se
 *   ancla a ESE div, no al de fuera, asi que cuando la pagina envuelve
 *   la tabla en un contenedor con `max-h` + `overflow-auto` para tener
 *   encabezado fijo, el encabezado no se pega: se va con las filas.
 *
 *   Con `sinContenedor` la tabla sale desnuda y el sticky se ancla al
 *   contenedor de la pagina, que es lo que se buscaba. Solo debe usarse
 *   cuando ese contenedor existe; si no, la tabla ancha desbordaria sin
 *   barra horizontal.
 */
function Table({
  className,
  sinContenedor,
  ...props
}: React.ComponentProps<'table'> & { sinContenedor?: boolean }) {
  const tabla = (
    <table
      data-slot="table"
      className={cn('w-full caption-bottom text-sm', className)}
      {...props}
    />
  )
  if (sinContenedor) return tabla
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      {tabla}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
