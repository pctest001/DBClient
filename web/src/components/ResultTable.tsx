import { useState, useMemo } from 'react';
import {
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useAppStore } from '../store/appStore';
import { toCsv, downloadCsv } from '../utils/csv';

/**
 * 查询结果表格（P0-2 / P1-2 / P1-5）：列排序、导出 CSV、行数与耗时展示。
 */
export default function ResultTable(): JSX.Element {
  const result = useAppStore((s) => s.queryResult);
  const loading = useAppStore((s) => s.queryLoading);
  const error = useAppStore((s) => s.queryError);
  const current = useAppStore((s) => s.currentConnection);

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!result) return [];
    if (!sortCol) return result.rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...result.rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      const as = av == null ? '' : typeof av === 'object' ? JSON.stringify(av) : String(av);
      const bs = bv == null ? '' : typeof bv === 'object' ? JSON.stringify(bv) : String(bv);
      return as.localeCompare(bs, 'zh-Hans-CN') * dir;
    });
  }, [result, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const handleExport = () => {
    if (!result) return;
    const csv = toCsv(result.columns, result.rows);
    const name = `query_${current?.name ?? 'result'}_${Date.now()}.csv`;
    downloadCsv(csv, name);
  };

  if (!current) {
    return (
      <Box className="h-full flex items-center justify-center text-gray-400 text-sm">
        请先在左侧选择一个数据库连接
      </Box>
    );
  }

  if (loading) {
    return (
      <Box className="h-full flex items-center justify-center text-gray-400 text-sm">
        查询执行中…
      </Box>
    );
  }

  if (error) {
    return (
      <Box className="h-full p-4">
        <Chip color="error" label="执行失败" className="mb-2" />
        <Typography className="text-red-600 whitespace-pre-wrap break-words text-sm">{error}</Typography>
      </Box>
    );
  }

  if (!result) {
    return (
      <Box className="h-full flex items-center justify-center text-gray-400 text-sm">
        执行 SQL 后在此查看结果
      </Box>
    );
  }

  return (
    <Box className="flex flex-col h-full">
      <Box className="flex items-center px-3 py-1.5 border-b border-gray-200 bg-white text-sm">
        <Typography variant="body2" className="text-gray-600">
          共 {result.rowCount} 行 · 耗时 {result.elapsedMs} ms
        </Typography>
        {result.truncated && (
          <Chip size="small" color="warning" label={`已截断（LIMIT ${result.appliedLimit}）`} className="ml-3" />
        )}
        <Box className="flex-1" />
        <Tooltip title="导出 CSV（P1-2）">
          <IconButton size="small" onClick={handleExport}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box className="flex-1 overflow-auto">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {result.columns.map((col) => (
                <TableCell key={col} className="font-semibold bg-gray-50 whitespace-nowrap">
                  <TableSortLabel
                    active={sortCol === col}
                    direction={sortCol === col ? sortDir : 'asc'}
                    onClick={() => handleSort(col)}
                  >
                    {col}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRows.map((row, idx) => (
              <TableRow key={idx} hover>
                {result.columns.map((col) => (
                  <TableCell key={col} className="whitespace-nowrap max-w-[360px] truncate">
                    {formatCell(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {result.rows.length === 0 && (
          <Typography className="p-4 text-gray-400 text-sm">查询成功，但未返回数据行。</Typography>
        )}
      </Box>
    </Box>
  );
}

/** 单元格展示：null → NULL，对象 → JSON。 */
function formatCell(value: unknown): JSX.Element | string {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">NULL</span>;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
