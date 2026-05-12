import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, data, rowKey, emptyMessage = 'No records found.' }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-[24px] border shadow-sm" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full divide-y" style={{ borderColor: 'var(--sos-border-subtle)' }}>
          <thead style={{ backgroundColor: 'var(--sos-surface-1)' }}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide sm:px-4"
                  style={{ color: 'var(--sos-text-muted)' }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--sos-border-subtle)' }}>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--sos-text-muted)' }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} className={`px-3 py-3 align-top text-sm break-words sm:px-4 ${column.className ?? ''}`} style={{ color: 'var(--sos-text-secondary)' }}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t px-3 py-2 text-xs sm:hidden" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-muted)' }}>
        Swipe horizontally to view all columns.
      </div>
    </div>
  );
}