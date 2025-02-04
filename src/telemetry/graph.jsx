/* eslint-disable jsx-a11y/anchor-is-valid */
import MG from 'metrics-graphics';
import PropTypes from 'prop-types';
import React from 'react';
import { Log } from '../vendor/logs';
import { fetchJson, URL } from '../vendor/requests';
import SETTINGS from '../settings';
import { withErrorBoundary } from '../vendor/errors';

class TelemetryContainer extends React.Component {
  async componentDidMount() {
    await this.fetchPlotGraph(this.props.id, this.props.queryParams);
  }

  async fetchPlotGraph(id, queryParams) {
    const url = URL({
      path: [SETTINGS.backend, 'api/perf/telemetry'],
      query: {
        name: id,
        ...queryParams,
      },
    });

    try {
      const { graphData, telemetryUrl } = await fetchJson(url);

      if (!this.graphTitleLink) {
        return;
      }

      const fullTelemetryUrl = URL({
        path: telemetryUrl,
        query: { processType: 'parent' },
      });

      this.graphTitleLink.setAttribute('href', fullTelemetryUrl);
      this.graphSubtitleEl.textContent = graphData.description;
      this.graphEvolutionsTimeline(graphData, this.graphEl);
    } catch (cause) {
      throw Log.error('Problem loading {{url}}', { url }, cause);
    }
  }

  graphEvolutionsTimeline({
    datas, params, yLabel, legendLabels,
  }, graphEl) {
    const newDatas = datas.map(evo => MG.convert.date(evo, 'date'));

    MG.data_graphic({
      data: newDatas,
      chart_type: 'line',
      full_width: true,
      full_height: true,
      top: 0,
      right: 0,
      bottom: 40,
      left: 80,
      min_y_from_data: true,
      target: graphEl,
      x_extended_ticks: true,
      x_label: params.useSubmissionDate ? 'Submission Date' : 'Built Date',
      y_label: yLabel,
      xax_format: date => `${date.getMonth() + 1}-${date.getDate()}`,
      yax_format: y => y,
      transition_on_update: false,
      legend: legendLabels,
      legend_target: graphEl.querySelector('.graph-legend'),
      aggregate_rollover: true,
      show_secondary_x_label: false,
    });
  }

  render() {
    const { id, title } = this.props;

    if (title) {
      return (
        <div id={id} key={id} className="criteria-widget">
          <header>
            <h3 className="graph-title">
              <a
                className="graph-title-link"
                ref={a => (this.graphTitleLink = a)}
              >
                {title}
              </a>
            </h3>
          </header>
          <div>
            <div
              className="graph-subtitle"
              ref={div => (this.graphSubtitleEl = div)}
            >
              {}
            </div>
            <div className="graph" ref={div => (this.graphEl = div)}>
              <div className="graph-legend">{}</div>
            </div>
          </div>
        </div>
      );
    }
  }
}

TelemetryContainer.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  queryParams: PropTypes.shape({}),
};

export default withErrorBoundary(TelemetryContainer);
