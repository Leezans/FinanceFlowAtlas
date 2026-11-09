import type {Metadata} from 'next';
import NewsWorkspace from '@/components/news/NewsWorkspace';

export const metadata: Metadata = {
  title: '全球新闻与日程 · Finance Flow Atlas',
  description: '精选科技、地缘政治与金融公开来源，分别呈现新闻发布和未来官方日程，保留来源、时间与不确定性。',
};

export default function NewsPage() {
  return <NewsWorkspace/>;
}
