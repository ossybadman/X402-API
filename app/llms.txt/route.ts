import '../inspect/route'; // routes register on import, so list every route file here
import { serve } from '../../lib/serve';

export const GET = serve.llms();
