import { Box, Divider } from '@mui/material';
import ConnectionManager from '../components/ConnectionManager';
import SqlEditor from '../components/SqlEditor';
import ResultTable from '../components/ResultTable';
import AiPanel from '../components/AiPanel';
import HistoryPanel from '../components/HistoryPanel';

/**
 * 工作台主页面（P0-1~P0-5）：左连接/历史、中编辑器/结果、右 AI 面板。
 */
export default function MainPage(): JSX.Element {
  return (
    <Box className="flex h-full">
      {/* 左侧：连接管理 + 历史 */}
      <Box className="w-[300px] shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <Box className="flex-[3_1_0%] min-h-0">
          <ConnectionManager />
        </Box>
        <Divider />
        <Box className="flex-[2_1_0%] min-h-0">
          <HistoryPanel />
        </Box>
      </Box>

      {/* 中间：SQL 编辑器 + 结果表格 */}
      <Box className="flex-1 flex flex-col min-w-0 bg-white">
        <Box className="flex-[0_0_40%] min-h-0 border-b border-gray-200">
          <SqlEditor />
        </Box>
        <Box className="flex-1 min-h-0">
          <ResultTable />
        </Box>
      </Box>

      {/* 右侧：AI 面板 */}
      <Box className="w-[340px] shrink-0 border-l border-gray-200 flex flex-col min-h-0">
        <AiPanel />
      </Box>
    </Box>
  );
}
