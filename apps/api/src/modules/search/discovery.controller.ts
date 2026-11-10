import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type FeedPage,
  type FeedQuery,
  feedQuerySchema,
  type SearchPage,
  type SearchQuery,
  searchQuerySchema,
} from '@xatu/shared';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';

@ApiTags('discovery')
@Controller()
@UseGuards(RateLimitGuard)
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('feed')
  @RateLimit({ name: 'discovery:feed', limit: 120, windowSeconds: 60 })
  @ApiOperation({
    summary:
      'Home feed: live products near a point (rounded to ~1 km), best first; makers on page 1',
  })
  feed(@Query(new ZodValidationPipe(feedQuerySchema)) query: FeedQuery): Promise<FeedPage> {
    return this.discovery.feed(query);
  }

  @Get('search')
  @RateLimit({ name: 'discovery:search', limit: 120, windowSeconds: 60 })
  @ApiOperation({ summary: 'Search Tamil and English titles and shop names, with transliteration' })
  search(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchPage> {
    return this.discovery.search(query);
  }
}
