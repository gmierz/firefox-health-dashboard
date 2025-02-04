import React, { Component } from 'react';
import Grid from '@material-ui/core/Grid/Grid';
import CircularProgress from '@material-ui/core/CircularProgress/CircularProgress';
import { URL } from '../vendor/requests';
import { selectFrom } from '../vendor/vectors';
import { coalesce, missing } from '../vendor/utils';
import { geomean, round, sum } from '../vendor/math';
import {
  PLATFORMS,
  TP6_COMBOS,
  TP6_TESTS,
  TP6M_SITES,
} from '../quantum/config';
import { getData } from '../vendor/perfherder';
import { withErrorBoundary } from '../vendor/errors';
import jx from '../vendor/jx/expressions';
import { Cube, HyperCube, window } from '../vendor/jx/cubes';
import { g5Reference, TARGET_NAME } from './config';
import ChartJSWrapper from '../vendor/components/chartJs/ChartJsWrapper';
import timer from '../vendor/timer';
import { DetailsIcon } from '../utils/icons';

/*
condition - json expression to pull perfherder data
 */
async function pullAggregate({
  condition,
  tests,
  sites,
  platforms,
  timeDomain,
}) {
  const readData = timer('read data');
  const sources = await getData(condition);

  readData.done();

  const processData = timer('process data');
  const measured = selectFrom(sources)
    .select('data')
    .flatten()
    /* eslint-disable-next-line camelcase */
    .filter(({ push_timestamp }) => timeDomain.includes(push_timestamp))
    .map(row => ({ ...row, ...row.meta }))
    .edges([
      {
        name: 'test',
        domain: {
          type: 'set',
          partitions: tests.select({
            name: 'label',
            value: 'test',
            where: 'testFilter',
          }),
        },
      },
      {
        name: 'site',
        domain: {
          type: 'set',
          partitions: sites.select({
            name: 'site',
            value: 'site',
            where: 'siteFilter',
          }),
        },
      },
      {
        name: 'platform',
        domain: {
          type: 'set',
          partitions: platforms.select({
            name: 'platform',
            value: 'platform',
            where: 'platformFilter',
          }),
        },
      },
      {
        name: 'pushDate',
        value: 'push_timestamp',
        domain: timeDomain,
      },
    ]);
  const afterLastGoodDate = window(
    { measured },
    {
      // INDEX OF DATE MARKS THE END OF THE DATA
      edges: ['test', 'site', 'platform'],
      value: ({ measured }) => measured.length
        - measured
          .slice()
          .reverse()
          .findIndex(m => m.length > 0),
    },
  );
  const daily = window(
    { measured, afterLastGoodDate },
    {
      // CHECK EACH TEST/SITE/DAY FOR MISSING VALUES
      edges: ['test', 'site', 'platform'],
      along: ['pushDate'],
      value: (row, num, rows) => {
        const { measured, afterLastGoodDate } = row;

        if (num > 0 && num < afterLastGoodDate && measured.length === 0) {
          return rows[num - 1];
        }

        return selectFrom(measured)
          .select('value')
          .average();
      },
    },
  );
  const result = window(
    { daily, g5Reference },
    {
      edges: ['test', 'platform', 'pushDate'],
      value: (row) => {
        const { daily, g5Reference } = row;

        return round(
          selectFrom(daily, g5Reference)
            // IF NO REFERENCE VALUE FOR SITE, DO NOT INCLUDE IN AGGREGATE
            .map((d, r) => (missing(r) ? null : d))
            .geomean(),
          { places: 4 },
        );
      },
    },
  );
  const mask = window(
    { daily },
    {
      edges: ['test', 'platform', 'site'],
      value: ({ daily }) => !selectFrom(daily)
        .reverse()
        .limit(8) // 7+1 for the null entry
        .exists()
        .isEmpty(),
    },
  );
  const count = window(
    { mask },
    {
      edges: ['test', 'platform'],
      value: ({ mask }) => sum(selectFrom(mask).map(m => (m ? 1 : 0))),
    },
  );
  const total = Cube.newInstance({ edges: [], zero: () => sites.count() });
  const ref = window(
    { mask, g5Reference },
    {
      edges: ['test', 'platform'],
      value: ({ mask, g5Reference }) => geomean(selectFrom(mask, g5Reference).map((m, r) => (m ? r : null))),
    },
  );

  processData.done();

  return new HyperCube({
    result, ref, count, total,
  });
}

const DESIRED_TESTS = ['cold-loadtime'];
const DESIRED_PLATFORMS = ['fenix-p2-aarch64', 'fenix-g5'];

class TP6mAggregate_ extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  async componentDidMount() {
    const { timeDomain } = this.props;
    const platforms = selectFrom(PLATFORMS).where({
      platform: DESIRED_PLATFORMS,
    });
    const condition = {
      or: TP6_COMBOS.filter(
        jx({
          and: [
            { eq: { browser: ['fenix'] } },
            {
              eq: {
                platform: DESIRED_PLATFORMS,
                test: DESIRED_TESTS,
              },
            },
          ],
        }),
      ).select('filter'),
    };
    const data = await pullAggregate({
      condition,
      sites: TP6M_SITES,
      tests: TP6_TESTS.where({ test: DESIRED_TESTS }),
      platforms,
      timeDomain,
    });

    this.setState({ data });
  }

  render() {
    const { data } = this.state;

    if (missing(data)) {
      return (
        <div
          style={{
            lineHeight: '100%',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <CircularProgress />
        </div>
      );
    }

    return (
      <Grid container spacing={24}>
        {selectFrom(TP6_TESTS)
          .where({ test: DESIRED_TESTS })
          .enumerate()
          .map(({ label, test }) => data
            .where({ test })
            .along('platform')
            .enumerate()
            .map((row) => {
              const platform = row.platform.getValue();
              const count = row.count.getValue();
              const total = row.total.getValue();
              const platformLabel = selectFrom(PLATFORMS)
                .where({ platform })
                .first().label;

              return (
                <Grid item xs={6} key={platform}>
                  <ChartJSWrapper
                    title={(
                      <span>
                        {`Geomean of ${label}`}
                        {' for '}
                        {platformLabel}
                        {' ( '}
                        {count}
                        {' of '}
                        {total}
                        {' sites reporting)'}
                        <a
                          href={URL({
                            path: '/android/tp6m',
                            query: {
                              test,
                              platform,
                            },
                          })}
                          title="show details"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <DetailsIcon />
                        </a>
                      </span>
)}
                    standardOptions={{
                      series: [
                        {
                          label: platformLabel,
                          select: { value: 'result' },
                        },
                        {
                          label: TARGET_NAME,
                          select: { value: coalesce(row.ref.getValue(), 0) },
                          style: { color: 'gray' },
                        },
                        {
                          label: 'Push Date',
                          select: { value: 'pushDate', axis: 'x' },
                        },
                      ],
                      data: row
                        .along('pushDate')
                        .map(({ pushDate, result }) => ({
                          pushDate: pushDate.getValue(),
                          result: result.getValue(),
                        }))
                        .toArray(),
                    }}
                  />
                </Grid>
              );
            }))
          .flatten()
          .toArray()}
      </Grid>
    );
  }
}

const TP6mAggregate = withErrorBoundary(TP6mAggregate_);

export { TP6mAggregate, pullAggregate };
