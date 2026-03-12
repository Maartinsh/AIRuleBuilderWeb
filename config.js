/**
 * Rule Builder — Configuration & Data Maps
 *
 * All domain-specific constants, trigger mappings, condition configs,
 * variable suggestions, and rule templates live here.
 *
 * To adapt this tool for your own project:
 *   1. Update TRIGGER_IDS with your data sources and trigger IDs
 *   2. Update PARAMETERS with per-source parameter hints
 *   3. Update TRIGGER_CONDITION_CONFIG for trigger-specific behavior
 *   4. Update VARIABLE_PARAMS with per-source variable parameter options
 *   5. Update TEMPLATES with your pre-built rule examples
 */
'use strict';

/* =========================================================
   TRIGGER IDS — grouped by data source
   Derived from JSON_RULE_STRUCTURE.md trigger ID reference.
   ========================================================= */

const TRIGGER_IDS = {
  SmartDrive: [
    'trip_started', 'trip_ended', 'trip_speed', 'trip_duration', 'trip_distance',
    'driving_behaviour_event_acceleration', 'driving_behaviour_event_braking',
    'driving_behaviour_event_cornering', 'distracted_phone_use',
    'distracted_phone_call_with_headset', 'distracted_phone_call_without_headset'
  ],
  BLE: [
    'beacon_emergency_button_pressed', 'beacon_connected', 'beacon_disconnected',
    'beacon_paired', 'beacon_unpaired', 'beacon_in_range', 'beacon_out_of_range',
    'beacon_accident_detected', 'fuel_level'
  ],
  POI: ['poi_entry', 'poi_exit', 'job_destination_entry', 'job_destination_exit'],
  DateTime: ['hour_changed', 'day_changed'],
  Phone: ['hour_changed', 'day_changed', 'battery_level_changed', 'battery_low'],
  Wellness: ['wellness_measurement_taken'],
  MZONE: [
    'get_all_jobs', 'get_todays_jobs', 'get_remaining_jobs', 'job_route_in_progress',
    'dynamic_changes_to_the_route', 'morning_jobs', 'job_details', 'job_details_updated',
    'updatedJobDetails', 'job_destination_entry', 'description', 'firstname',
    'customer_communication', 'score', 'montly_score_decreased', 'todays_braking_score',
    'get_measurements', 'last_health_check', 'get_trips', 'get_events',
    'current_location', 'poi_entry', 'poi_exit', 'location_request', 'emergency_flow'
  ],
  GZONE: ['leaderboard_position_declined', 'leaderboard_check'],
  'External Source': [
    'weather_forecast', 'todays_weather_forecast', 'forecast_for_upcoming_hour',
    'real_time_weather_updates', 'google_nearby_gas_station', 'google_nearby_coffee_shop',
    'google_nearby_restaurant', 'google_nearby_fast_food_restaurant', 'google_nearby_cafe',
    'google_nearby_pharmacy', 'google_nearby_hospital', 'google_nearby_atm',
    'google_nearby_parking', 'google_nearby_electric_vehicle_charging_station',
    'google_nearby_car_wash', 'google_nearby_car_repair', 'google_nearby_convenience_store'
  ]
};

/* =========================================================
   PARAMETER HINTS — per data source (for condition autocomplete)
   ========================================================= */

const PARAMETERS = {
  SmartDrive: ['speed', 'duration', 'distance', 'duration_millis'],
  BLE: ['level', 'consumption', 'isConnected', 'isAccident', 'isEmergency'],
  POI: ['poi_type', 'poi_id', 'poi_name'],
  DateTime: ['hour', 'day_of_week'],
  Phone: ['hour', 'day_of_week', 'battery_level', 'is_charging'],
  Wellness: [
    'stressIndex', 'normalizedStressIndex', 'stressCategory', 'wellnessIndex',
    'wellnessLevel', 'hemoglobin', 'oxygenSaturation', 'rmssd', 'sdnn',
    'measurementTimestamp', 'hoursAgo'
  ],
  MZONE: [
    'count', 'pendingJobs', 'completedJobs', 'inProgressJobs', 'RouteState',
    'score', 'status', 'hasProblematicJobs', 'hasDepotJobs'
  ],
  GZONE: ['position', 'leaderboardId'],
  'External Source': [
    'placesFound', 'closestFuelStation', 'closestPlaceName',
    'closestPlaceAddress', 'closestPlaceRating', 'driving_conditions'
  ]
};

/**
 * FILTER_FIELDS — fields available for filtering array items in variable extraction.
 * Keyed by source key (e.g. 'jobs', 'trips', 'events').
 * Each field has an id, type hint ('int', 'string', 'bool', 'double', 'datetime'), and label.
 */
const FILTER_FIELDS = {
  jobs: [
    { id: 'jobStatus_Id', type: 'int', label: '1=New, 2=InProgress, 3=Completed' },
    { id: 'priority', type: 'int', label: 'job priority' },
    { id: 'isCompleted', type: 'bool', label: 'true/false' },
    { id: 'isProblematic', type: 'bool', label: 'true/false' },
    { id: 'isDepotJob', type: 'bool', label: 'true/false' },
    { id: 'loadingUnits', type: 'double', label: 'loading units' },
    { id: 'drivingDistance', type: 'double', label: 'km' },
    { id: 'description', type: 'string', label: 'job description' },
    { id: 'customerName', type: 'string', label: 'customer name' },
    { id: 'jobStatus_Description', type: 'string', label: 'status text' },
  ],
  trips: [
    { id: 'distance', type: 'double', label: 'km' },
    { id: 'duration', type: 'int', label: 'seconds' },
    { id: 'maxSpeed', type: 'double', label: 'km/h' },
    { id: 'avgSpeed', type: 'double', label: 'km/h' },
    { id: 'fuelUsed', type: 'double', label: 'liters' },
    { id: 'numberOfExceptions', type: 'int', label: 'total exceptions' },
    { id: 'numberOfHarshBrakingExceptions', type: 'int', label: 'harsh braking count' },
    { id: 'numberOfSpeedingExceptions', type: 'int', label: 'speeding count' },
    { id: 'numberOfCorneringExceptions', type: 'int', label: 'cornering count' },
    { id: 'numberOfExcessiveAccelerationExceptions', type: 'int', label: 'acceleration count' },
    { id: 'isBusiness', type: 'bool', label: 'true/false' },
  ],
  events: [
    { id: 'speed', type: 'double', label: 'km/h' },
    { id: 'overspeed', type: 'double', label: 'km/h over limit' },
    { id: 'eventType_Id', type: 'string', label: 'event type ID' },
    { id: 'eventType_Description', type: 'string', label: 'event type description' },
  ]
};

/* =========================================================
   ENUMS & CONSTANTS
   ========================================================= */

const DATA_SOURCES = [
  'SmartDrive', 'BLE', 'POI', 'DateTime', 'Phone',
  'Wellness', 'MZONE', 'GZONE', 'External Source'
];

const OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in'];
const CONDITION_TYPES = ['Value', 'TimeRange', 'Time', 'Comparison', 'EventCount', 'RelativeTimeWindow'];
const NUMERIC_OPERATORS = ['==', '!=', '<', '<=', '>', '>='];
const TIME_PERIODS = ['currentMonth', 'lastMonth', 'currentWeek', 'lastWeek'];

/* =========================================================
   TRIGGER CONDITION CONFIG
   Controls which condition types, parameters, and operators
   are valid per trigger ID.
   ========================================================= */

/** Shared config factory for all Google Places triggers. */
function _googlePlacesConfig() {
  return {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'placesFound',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Min. places found (e.g. 1)',
    hideSource: true
  };
}

const TRIGGER_CONDITION_CONFIG = {
  // ── SmartDrive ──
  trip_speed: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'speed',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Speed in km/h (e.g. 120)',
    hideSource: true
  },
  trip_duration: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'duration',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Duration in minutes (e.g. 120)',
    hideSource: true
  },
  trip_distance: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'distance',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Distance in meters (e.g. 5000)',
    hideSource: true
  },
  distracted_phone_use: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'duration_millis',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Duration in milliseconds (e.g. 5000)',
    hideSource: true
  },
  distracted_phone_call_with_headset: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'duration_millis',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Duration in milliseconds (e.g. 5000)',
    hideSource: true
  },
  distracted_phone_call_without_headset: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'duration_millis',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Duration in milliseconds (e.g. 5000)',
    hideSource: true
  },
  driving_behaviour_event_acceleration: {
    conditionRequired: false,
    defaultConditionType: 'EventCount',
    defaultEventName: 'driving_behaviour_event_acceleration',
    parameterLocked: false,
    validConditionTypes: ['EventCount'],
    validOperators: NUMERIC_OPERATORS,
    hideSource: true
  },
  driving_behaviour_event_braking: {
    conditionRequired: false,
    defaultConditionType: 'EventCount',
    defaultEventName: 'driving_behaviour_event_braking',
    parameterLocked: false,
    validConditionTypes: ['EventCount'],
    validOperators: NUMERIC_OPERATORS,
    hideSource: true
  },
  driving_behaviour_event_cornering: {
    conditionRequired: false,
    defaultConditionType: 'EventCount',
    defaultEventName: 'driving_behaviour_event_cornering',
    parameterLocked: false,
    validConditionTypes: ['EventCount'],
    validOperators: NUMERIC_OPERATORS,
    hideSource: true
  },

  // ── BLE ──
  fuel_level: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'level',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Fuel level (e.g. 20)',
    hideSource: false
  },

  // ── POI ──
  poi_entry: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'poi_type',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'POI type or name',
    hideSource: true
  },
  poi_exit: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'poi_type',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'POI type or name',
    hideSource: true
  },

  // ── DateTime / Phone ──
  hour_changed: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'hour',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time'],
    validOperators: OPERATORS,
    valueHint: 'Hour (0-23) or day (e.g. MON)',
    hideSource: true
  },
  day_changed: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'day_of_week',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'e.g. MON, TUE or use "in" for multiple',
    hideSource: true
  },

  // ── Phone ──
  battery_level_changed: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'battery_level',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Battery % (e.g. 20)',
    hideSource: true
  },

  // ── MZONE (API) ──
  get_all_jobs: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of jobs (e.g. 5)',
    hideSource: true
  },
  get_todays_jobs: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of jobs (e.g. 5)',
    hideSource: true
  },
  get_remaining_jobs: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of remaining jobs (e.g. 3)',
    hideSource: true
  },
  morning_jobs: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of morning jobs (e.g. 3)',
    hideSource: true
  },
  score: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'score',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Score value (e.g. 70)',
    hideSource: true
  },
  montly_score_decreased: {
    conditionRequired: false,
    defaultConditionType: 'Comparison',
    defaultParameter: 'score',
    parameterLocked: true,
    validConditionTypes: ['Comparison', 'Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Score threshold',
    hideSource: true
  },
  todays_braking_score: {
    conditionRequired: true,
    defaultConditionType: 'Value',
    defaultParameter: 'score',
    parameterLocked: true,
    validConditionTypes: ['Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Braking score (e.g. 50)',
    hideSource: true
  },
  get_trips: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of trips (e.g. 3)',
    hideSource: true
  },
  get_events: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of events (e.g. 5)',
    hideSource: true
  },
  get_measurements: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'count',
    parameterLocked: false,
    validConditionTypes: ['Value', 'TimeRange', 'Time', 'RelativeTimeWindow'],
    validOperators: OPERATORS,
    valueHint: 'Number of measurements',
    hideSource: true
  },
  last_health_check: {
    conditionRequired: false,
    defaultConditionType: 'RelativeTimeWindow',
    defaultParameter: 'lastCheckTimestamp',
    parameterLocked: false,
    validConditionTypes: ['RelativeTimeWindow', 'Value'],
    validOperators: OPERATORS,
    valueHint: 'Time since last check (e.g. 1h, -4h)',
    hideSource: true
  },

  // ── GZONE ──
  leaderboard_position_declined: {
    conditionRequired: false,
    defaultConditionType: 'Comparison',
    defaultParameter: 'position',
    parameterLocked: true,
    validConditionTypes: ['Comparison', 'Value'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Position threshold',
    hideSource: true
  },
  leaderboard_check: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'position',
    parameterLocked: false,
    validConditionTypes: ['Value', 'Comparison'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Leaderboard position (e.g. 10)',
    hideSource: true
  },

  // ── External Source — Weather ──
  weather_forecast: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'driving_conditions',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'Condition (e.g. rain, snow, clear)',
    hideSource: true
  },
  todays_weather_forecast: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'driving_conditions',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'Condition (e.g. rain, snow, clear)',
    hideSource: true
  },
  forecast_for_upcoming_hour: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'driving_conditions',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'Condition (e.g. rain, snow, clear)',
    hideSource: true
  },
  real_time_weather_updates: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'driving_conditions',
    parameterLocked: false,
    validConditionTypes: ['Value'],
    validOperators: OPERATORS,
    valueHint: 'Condition (e.g. rain, snow, clear)',
    hideSource: true
  },

  // ── External Source — Google Places ──
  google_nearby_gas_station: _googlePlacesConfig(),
  google_nearby_coffee_shop: _googlePlacesConfig(),
  google_nearby_restaurant: _googlePlacesConfig(),
  google_nearby_fast_food_restaurant: _googlePlacesConfig(),
  google_nearby_cafe: _googlePlacesConfig(),
  google_nearby_pharmacy: _googlePlacesConfig(),
  google_nearby_hospital: _googlePlacesConfig(),
  google_nearby_atm: _googlePlacesConfig(),
  google_nearby_parking: _googlePlacesConfig(),
  google_nearby_electric_vehicle_charging_station: _googlePlacesConfig(),
  google_nearby_car_wash: _googlePlacesConfig(),
  google_nearby_car_repair: _googlePlacesConfig(),
  google_nearby_convenience_store: _googlePlacesConfig(),

  // ── Wellness ──
  wellness_measurement_taken: {
    conditionRequired: false,
    defaultConditionType: 'Value',
    defaultParameter: 'stressIndex',
    parameterLocked: false,
    validConditionTypes: ['Value', 'RelativeTimeWindow'],
    validOperators: NUMERIC_OPERATORS,
    valueHint: 'Threshold value',
    hideSource: true
  }
};

/* =========================================================
   VARIABLE CATEGORIES & PARAMETERS
   Two categories: API (fetched from external APIs) and
   Event/Device (real-time data from sensors and events).
   ========================================================= */

/** API-based data sources — support advanced options (source, fields, filters, triggerId). */
const API_DATA_SOURCES = ['MZONE', 'GZONE', 'External Source'];

/** Event/device data sources — simple extraction (dataSource + parameter). */
const EVENT_DATA_SOURCES = ['SmartDrive', 'BLE', 'POI', 'DateTime', 'Phone', 'Wellness'];

/**
 * API_ENDPOINTS — per data source, lists the actual API endpoints the engine supports.
 *
 * Each endpoint maps to a real ApiDataType in the engine.
 * Parameters are the individual response fields available from that endpoint.
 * Format: { id: 'fieldName', label: 'short description' }
 *   → displayed as: "fieldName — short description"
 *   → LLM receives: fieldName = <value>
 *
 * Array extraction params also have source/fields:
 *   { id: 'varName', label: 'description', source: 'arrayKey', fields: [...] }
 *   → LLM receives: varName = [{...}, {...}]
 */
const API_ENDPOINTS = {
  MZONE: [
    {
      id: 'get_todays_jobs',
      label: "Today's Jobs",
      description: "JOBS_ACTIVE — today's active jobs with counts, statuses, next job info",
      apiType: 'JOBS_ACTIVE',
      params: [
        { id: 'count', label: 'total jobs' },
        { id: 'pendingJobs', label: 'pending jobs count' },
        { id: 'completedJobs', label: 'completed jobs count' },
        { id: 'inProgressJobs', label: 'in-progress jobs count' },
        { id: 'routeState', label: 'HasJobs or NoJobs' },
        { id: 'hasProblematicJobs', label: 'any problematic jobs?' },
        { id: 'hasDepotJobs', label: 'any depot jobs?' },
        { id: 'nextJobDescription', label: 'next job description' },
        { id: 'nextJobReference', label: 'next job reference' },
        { id: 'nextJobPlannedArrival', label: 'next job planned arrival' },
        { id: 'nextJobPlannedDeparture', label: 'next job planned departure' },
        { id: 'nextJobCustomerName', label: 'next job customer name' },
        { id: 'nextJobDistance', label: 'distance to next job (km)' },
        { id: 'nextJobLat', label: 'next job latitude' },
        { id: 'nextJobLng', label: 'next job longitude' },
        { id: 'nextJobIsProblematic', label: 'next job is problematic?' },
        { id: 'nextJobIsDepot', label: 'next job is depot?' },
        { id: 'plannedDepartureDateTime', label: 'planned departure time' },
        { id: 'latestJobActualStart', label: 'latest started job time' },
        { id: 'earliestJobActualStart', label: 'earliest started job time' },
        { id: 'latestJobActualArrival', label: 'latest job arrival time' },
        { id: 'todaysJobs', label: 'job list — status & timing', source: 'jobs', fields: ['id', 'description', 'jobStatus_Id', 'utcPlannedArrival', 'priority'] },
        { id: 'todaysSchedule', label: 'job list — schedule only', source: 'jobs', fields: ['id', 'description', 'utcPlannedDeparture', 'utcPlannedArrival'] },
        { id: 'todaysCustomers', label: 'job list — customer info', source: 'jobs', fields: ['id', 'description', 'customerName', 'contactPerson', 'contactPhone'] },
      ]
    },
    {
      id: 'get_all_jobs',
      label: 'All Jobs (Historical)',
      description: 'JOBS_ALL — all jobs from last 2 weeks, same fields as today',
      apiType: 'JOBS_ALL',
      params: [
        { id: 'count', label: 'total jobs' },
        { id: 'pendingJobs', label: 'pending jobs count' },
        { id: 'completedJobs', label: 'completed jobs count' },
        { id: 'inProgressJobs', label: 'in-progress jobs count' },
        { id: 'routeState', label: 'HasJobs or NoJobs' },
        { id: 'hasProblematicJobs', label: 'any problematic jobs?' },
        { id: 'nextJobDescription', label: 'next pending job description' },
        { id: 'nextJobPlannedArrival', label: 'next job planned arrival' },
        { id: 'nextJobCustomerName', label: 'next job customer name' },
        { id: 'allJobs', label: 'job list — status overview', source: 'jobs', fields: ['id', 'description', 'jobStatus_Id'] },
        { id: 'allJobsDetailed', label: 'job list — full details', source: 'jobs', fields: ['id', 'description', 'jobStatus_Id', 'priority', 'utcPlannedArrival', 'utcActualArrival', 'isProblematic'] },
      ]
    },
    {
      id: 'get_remaining_jobs',
      label: 'Remaining Jobs',
      description: 'JOBS_ACTIVE — pending/upcoming jobs still to complete',
      apiType: 'JOBS_ACTIVE',
      params: [
        { id: 'count', label: 'remaining job count' },
        { id: 'pendingJobs', label: 'pending jobs count' },
        { id: 'nextJobDescription', label: 'next job description' },
        { id: 'nextJobPlannedArrival', label: 'next job planned arrival' },
        { id: 'nextJobCustomerName', label: 'next job customer name' },
        { id: 'nextJobDistance', label: 'distance to next job (km)' },
        { id: 'remainingJobs', label: 'job list — with arrival times', source: 'jobs', fields: ['id', 'description', 'utcPlannedArrival'] },
        { id: 'remainingJobsFull', label: 'job list — with priority & customer', source: 'jobs', fields: ['id', 'description', 'utcPlannedArrival', 'priority', 'customerName'] },
      ]
    },
    {
      id: 'morning_jobs',
      label: 'Morning Jobs',
      description: 'JOBS_ACTIVE — jobs scheduled for the morning shift',
      apiType: 'JOBS_ACTIVE',
      params: [
        { id: 'count', label: 'morning job count' },
        { id: 'pendingJobs', label: 'pending jobs count' },
        { id: 'nextJobDescription', label: 'first morning job description' },
        { id: 'nextJobPlannedDeparture', label: 'first departure time' },
        { id: 'morningJobs', label: 'job list — with departure times', source: 'jobs', fields: ['id', 'description', 'utcPlannedDeparture'] },
      ]
    },
    {
      id: 'job_details',
      label: 'Job Details',
      description: 'JOB_DETAILS — single job info including driver name, customer, timing',
      apiType: 'JOB_DETAILS',
      params: [
        { id: 'firstname', label: 'driver first name' },
        { id: 'description', label: 'job description' },
        { id: 'reference', label: 'job reference number' },
        { id: 'notes', label: 'job notes' },
        { id: 'priority', label: 'job priority' },
        { id: 'jobStatus_Description', label: 'job status text' },
        { id: 'jobStatus_Id', label: 'status ID (1=New, 2=InProgress, 3=Done)' },
        { id: 'isCompleted', label: 'is completed?' },
        { id: 'isProblematic', label: 'is problematic?' },
        { id: 'utcPlannedArrival', label: 'planned arrival time' },
        { id: 'utcPlannedDeparture', label: 'planned departure time' },
        { id: 'utcActualArrival', label: 'actual arrival time' },
        { id: 'utcActualDeparture', label: 'actual departure time' },
        { id: 'customerName', label: 'customer name' },
        { id: 'contactPerson', label: 'contact person' },
        { id: 'contactPhone', label: 'contact phone' },
        { id: 'endLatitude', label: 'job latitude' },
        { id: 'endLongitude', label: 'job longitude' },
        { id: 'drivingDistance', label: 'driving distance (km)' },
      ]
    },
    {
      id: 'get_trips',
      label: 'Trip History',
      description: 'TRIP_DETAILS — trips with distances, durations, exceptions, performance',
      apiType: 'TRIP_DETAILS',
      params: [
        { id: 'count', label: 'total trip count' },
        { id: 'totalDistance', label: 'total distance (km)' },
        { id: 'totalDuration', label: 'total duration (seconds)' },
        { id: 'totalExceptions', label: 'total exceptions' },
        { id: 'lastTripId', label: 'last trip ID' },
        { id: 'lastTripStart', label: 'last trip start time' },
        { id: 'lastTripEnd', label: 'last trip end time' },
        { id: 'lastTripDistance', label: 'last trip distance (km)' },
        { id: 'lastTripDuration', label: 'last trip duration (sec)' },
        { id: 'latestTripStart', label: 'latest trip start time' },
        { id: 'earliestTripStart', label: 'earliest trip start time' },
        { id: 'trips', label: 'trip list — distance & duration', source: 'trips', fields: ['id', 'startUtcTimestamp', 'endUtcTimestamp', 'distance', 'duration'] },
        { id: 'tripPerformance', label: 'trip list — speed & fuel', source: 'trips', fields: ['id', 'distance', 'duration', 'maxSpeed', 'avgSpeed', 'fuelUsed'] },
        { id: 'tripExceptions', label: 'trip list — exception counts', source: 'trips', fields: ['id', 'distance', 'duration', 'numberOfExceptions', 'numberOfHarshBrakingExceptions', 'numberOfSpeedingExceptions'] },
        { id: 'tripLocations', label: 'trip list — with locations', source: 'trips', fields: ['id', 'startLocationDescription', 'endLocationDescription', 'distance', 'startUtcTimestamp'] },
      ]
    },
    {
      id: 'get_events',
      label: 'Driving Events / Exceptions',
      description: 'TRIP_EVENTS — driving events with priority categorization',
      apiType: 'TRIP_EVENTS',
      params: [
        { id: 'count', label: 'total event count' },
        { id: 'highPriorityEvents', label: 'high priority events (8-10)' },
        { id: 'mediumPriorityEvents', label: 'medium priority events (5-7)' },
        { id: 'lowPriorityEvents', label: 'low priority events (1-4)' },
        { id: 'events', label: 'event list — type & speed', source: 'events', fields: ['id', 'utcTimestamp', 'eventType_Description', 'speed'] },
        { id: 'eventDetails', label: 'event list — with location & overspeed', source: 'events', fields: ['id', 'utcTimestamp', 'eventType_Description', 'speed', 'overspeed', 'locationDescription'] },
      ]
    },
    {
      id: 'get_measurements',
      label: 'Driver Measurements',
      description: 'DRIVER_MEASUREMENTS_SCORE — all driver scores and metrics from DInsight',
      apiType: 'DRIVER_MEASUREMENTS_SCORE',
      params: [
        { id: 'vehicleDrivingScore', label: 'driving score (0-100)' },
        { id: 'weightedDrivingScore', label: 'weighted driving score' },
        { id: 'ecoFriendlyScore', label: 'eco-friendly score (0-100)' },
        { id: 'mrmScore', label: 'MRM score' },
        { id: 'brakingScore', label: 'braking score (0-100)' },
        { id: 'accelerationScore', label: 'acceleration score (0-100)' },
        { id: 'speedScore', label: 'speed score (0-100)' },
        { id: 'cornersScore', label: 'cornering score (0-100)' },
        { id: 'vehicleCount', label: 'vehicle count' },
        { id: 'unassignedJobCount', label: 'unassigned job count' },
        { id: 'vehicleDowntime', label: 'vehicle downtime (days)' },
      ]
    },
  ],
  GZONE: [
    {
      id: 'leaderboard_check',
      label: 'Leaderboard',
      description: 'LEADERBOARDS_ALL — leaderboard position and ranking',
      apiType: 'LEADERBOARDS_ALL',
      params: [
        { id: 'position', label: 'leaderboard position' },
        { id: 'leaderboardId', label: 'leaderboard ID' },
      ]
    },
  ],
  'External Source': [
    {
      id: 'weather_forecast',
      label: 'Weather Forecast',
      description: 'WEATHER_FORECAST — general weather forecast',
      apiType: 'WEATHER_FORECAST',
      params: [
        { id: 'driving_conditions', label: 'driving conditions (good/bad)' },
        { id: 'temperature', label: 'temperature' },
        { id: 'precipitation', label: 'precipitation' },
        { id: 'humidity', label: 'humidity' },
        { id: 'windSpeed', label: 'wind speed' },
        { id: 'condition', label: 'weather condition text' },
      ]
    },
    {
      id: 'todays_weather_forecast',
      label: "Today's Weather",
      description: "WEATHER_FORECAST — today's weather forecast",
      apiType: 'WEATHER_FORECAST',
      params: [
        { id: 'driving_conditions', label: 'driving conditions (good/bad)' },
        { id: 'temperature', label: 'temperature' },
        { id: 'precipitation', label: 'precipitation' },
        { id: 'condition', label: 'weather condition text' },
      ]
    },
    {
      id: 'forecast_for_upcoming_hour',
      label: 'Hourly Forecast',
      description: 'WEATHER_FORECAST — forecast for the upcoming hour',
      apiType: 'WEATHER_FORECAST',
      params: [
        { id: 'driving_conditions', label: 'driving conditions' },
        { id: 'temperature', label: 'temperature' },
        { id: 'precipitation', label: 'precipitation' },
      ]
    },
    {
      id: 'real_time_weather_updates',
      label: 'Real-time Weather',
      description: 'WEATHER_FORECAST — live weather updates',
      apiType: 'WEATHER_FORECAST',
      params: [
        { id: 'driving_conditions', label: 'driving conditions' },
        { id: 'temperature', label: 'temperature' },
        { id: 'condition', label: 'weather condition text' },
      ]
    },
    {
      id: 'google_nearby_gas_station',
      label: 'Nearby Gas Station',
      description: 'GOOGLE_NEARBY_SEARCH — nearby gas/fuel stations',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest station name' },
        { id: 'closestPlaceAddress', label: 'closest station address' },
        { id: 'closestPlaceRating', label: 'closest station rating' },
        { id: 'closestPlaceLat', label: 'closest station latitude' },
        { id: 'closestPlaceLng', label: 'closest station longitude' },
        { id: 'placeNames', label: 'all station names (list)' },
        { id: 'placeAddresses', label: 'all station addresses (list)' },
      ]
    },
    {
      id: 'google_nearby_coffee_shop',
      label: 'Nearby Coffee Shop',
      description: 'GOOGLE_NEARBY_SEARCH — nearby coffee shops',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest shop name' },
        { id: 'closestPlaceAddress', label: 'closest shop address' },
        { id: 'closestPlaceRating', label: 'closest shop rating' },
        { id: 'placeNames', label: 'all shop names (list)' },
        { id: 'placeAddresses', label: 'all shop addresses (list)' },
      ]
    },
    {
      id: 'google_nearby_restaurant',
      label: 'Nearby Restaurant',
      description: 'GOOGLE_NEARBY_SEARCH — nearby restaurants',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest restaurant name' },
        { id: 'closestPlaceAddress', label: 'closest restaurant address' },
        { id: 'closestPlaceRating', label: 'closest restaurant rating' },
        { id: 'placeNames', label: 'all restaurant names (list)' },
      ]
    },
    {
      id: 'google_nearby_fast_food_restaurant',
      label: 'Nearby Fast Food',
      description: 'GOOGLE_NEARBY_SEARCH — nearby fast food restaurants',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest place name' },
        { id: 'closestPlaceAddress', label: 'closest place address' },
        { id: 'closestPlaceRating', label: 'closest place rating' },
      ]
    },
    {
      id: 'google_nearby_cafe',
      label: 'Nearby Cafe',
      description: 'GOOGLE_NEARBY_SEARCH — nearby cafes',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest cafe name' },
        { id: 'closestPlaceAddress', label: 'closest cafe address' },
        { id: 'closestPlaceRating', label: 'closest cafe rating' },
      ]
    },
    {
      id: 'google_nearby_pharmacy',
      label: 'Nearby Pharmacy',
      description: 'GOOGLE_NEARBY_SEARCH — nearby pharmacies',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest pharmacy name' },
        { id: 'closestPlaceAddress', label: 'closest pharmacy address' },
        { id: 'closestPlaceRating', label: 'closest pharmacy rating' },
      ]
    },
    {
      id: 'google_nearby_hospital',
      label: 'Nearby Hospital',
      description: 'GOOGLE_NEARBY_SEARCH — nearby hospitals',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest hospital name' },
        { id: 'closestPlaceAddress', label: 'closest hospital address' },
      ]
    },
    {
      id: 'google_nearby_atm',
      label: 'Nearby ATM',
      description: 'GOOGLE_NEARBY_SEARCH — nearby ATMs',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest ATM name' },
        { id: 'closestPlaceAddress', label: 'closest ATM address' },
      ]
    },
    {
      id: 'google_nearby_parking',
      label: 'Nearby Parking',
      description: 'GOOGLE_NEARBY_SEARCH — nearby parking',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest parking name' },
        { id: 'closestPlaceAddress', label: 'closest parking address' },
      ]
    },
    {
      id: 'google_nearby_electric_vehicle_charging_station',
      label: 'Nearby EV Charging',
      description: 'GOOGLE_NEARBY_SEARCH — nearby EV charging stations',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest station name' },
        { id: 'closestPlaceAddress', label: 'closest station address' },
      ]
    },
    {
      id: 'google_nearby_car_wash',
      label: 'Nearby Car Wash',
      description: 'GOOGLE_NEARBY_SEARCH — nearby car washes',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest car wash name' },
        { id: 'closestPlaceAddress', label: 'closest car wash address' },
      ]
    },
    {
      id: 'google_nearby_car_repair',
      label: 'Nearby Car Repair',
      description: 'GOOGLE_NEARBY_SEARCH — nearby car repair shops',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest repair shop name' },
        { id: 'closestPlaceAddress', label: 'closest repair shop address' },
      ]
    },
    {
      id: 'google_nearby_convenience_store',
      label: 'Nearby Convenience Store',
      description: 'GOOGLE_NEARBY_SEARCH — nearby convenience stores',
      apiType: 'GOOGLE_NEARBY_SEARCH',
      params: [
        { id: 'placesFound', label: 'number of places found' },
        { id: 'closestPlaceName', label: 'closest store name' },
        { id: 'closestPlaceAddress', label: 'closest store address' },
      ]
    },
  ]
};

/**
 * Event/device variable parameters — simple extraction (dataSource + parameter).
 * These don't go through API endpoints, they come from real-time sensor/event data.
 */
const EVENT_VARIABLE_PARAMS = {
  SmartDrive: [
    { id: 'speed', label: 'vehicle speed (km/h)' },
    { id: 'duration', label: 'trip duration (seconds)' },
    { id: 'distance', label: 'distance traveled (meters)' },
    { id: 'current_location', label: 'current GPS location' },
    { id: 'duration_millis', label: 'distraction duration (ms)' },
  ],
  BLE: [
    { id: 'isConnected', label: 'device connected (true/false)' },
    { id: 'level', label: 'fuel level (%)' },
    { id: 'consumption', label: 'fuel consumption rate' },
    { id: 'fuel_range', label: 'distance remaining on fuel' },
  ],
  POI: [
    { id: 'poi_id', label: 'POI identifier' },
    { id: 'poi_name', label: 'POI name' },
    { id: 'poi_type', label: 'POI category/type' },
  ],
  DateTime: [
    { id: 'hour', label: 'current hour (0-23)' },
    { id: 'day_of_week', label: 'day of week (MON-SUN)' },
  ],
  Phone: [
    { id: 'hour', label: 'current hour (0-23)' },
    { id: 'day_of_week', label: 'day of week (MON-SUN)' },
    { id: 'battery_level', label: 'battery level (0-100)' },
    { id: 'is_charging', label: 'is charging (true/false)' },
  ],
  Wellness: [
    { id: 'stressIndex', label: 'stress level (0-100)' },
    { id: 'normalizedStressIndex', label: 'normalized stress (-10 to 10)' },
    { id: 'stressCategory', label: 'stress category (LOW/NORMAL/HIGH)' },
    { id: 'wellnessIndex', label: 'wellness score (0-100)' },
    { id: 'wellnessLevel', label: 'wellness level label' },
    { id: 'hemoglobin', label: 'hemoglobin (g/dL)' },
    { id: 'oxygenSaturation', label: 'SpO2 percentage (0-100)' },
    { id: 'rmssd', label: 'HRV RMSSD indicator' },
    { id: 'sdnn', label: 'HRV SDNN indicator' },
    { id: 'hoursAgo', label: 'hours since measurement' },
  ]
};

/**
 * Backward-compatible helper: build a flat VARIABLE_PARAMS from API_ENDPOINTS + EVENT_VARIABLE_PARAMS.
 * Used by any code that still references VARIABLE_PARAMS directly.
 */
const VARIABLE_PARAMS = (() => {
  const result = { ...EVENT_VARIABLE_PARAMS };
  for (const [ds, endpoints] of Object.entries(API_ENDPOINTS)) {
    result[ds] = [];
    for (const ep of endpoints) {
      for (const p of ep.params) {
        result[ds].push({ ...p, triggerId: ep.id });
      }
    }
  }
  return result;
})();

/**
 * Trigger IDs that fire on event occurrence alone — no conditions needed.
 * Conditions can still be added manually via the toggle.
 */
const EVENT_ONLY_TRIGGERS = new Set([
  'trip_started', 'trip_ended',
  'beacon_emergency_button_pressed', 'beacon_connected', 'beacon_disconnected',
  'beacon_paired', 'beacon_unpaired', 'beacon_in_range', 'beacon_out_of_range',
  'beacon_accident_detected',
  'poi_entry', 'poi_exit', 'job_destination_entry', 'job_destination_exit',
  'driving_behaviour_event_acceleration', 'driving_behaviour_event_braking',
  'driving_behaviour_event_cornering',
  'distracted_phone_use', 'distracted_phone_call_with_headset',
  'distracted_phone_call_without_headset',
  'firstname', 'description', 'customer_communication', 'emergency_flow',
  'current_location', 'location_request',
  'job_details', 'job_details_updated', 'updatedJobDetails',
  'dynamic_changes_to_the_route', 'job_route_in_progress',
  'battery_low'
]);

const SCOPE_HINTS = {
  global: 'App lifetime — events retained forever (max 20K). Best for emergency, user commands.',
  daily: '24-hour scope — resets daily (max 10K). Best for greetings, summaries.',
  trip: 'Trip scope — until endTrip() (max 12h/10K). Best for speed, fatigue, driving alerts.'
};

/**
 * Variable scope requirements — minimum session scope needed for reliable data.
 * 'trip' = data only available in trip scope (buffer cleared on trip end)
 * 'any'  = data available in all scopes (API data, phone, wellness, POI events)
 */
const VARIABLE_SCOPE = {
  SmartDrive: 'trip',
  BLE: 'any',
  POI: 'any',
  DateTime: 'any',
  Phone: 'any',
  Wellness: 'any',
  MZONE: 'any',
  GZONE: 'any',
  'External Source': 'any'
};

/* =========================================================
   PUBLISH — GitHub repository target
   ========================================================= */

const GITHUB_OWNER = 'Maartinsh';
const GITHUB_REPO  = 'AIRuleBuilderWeb';
const GITHUB_RULES_PATH = 'rules/latest.json';

// Token is stored in localStorage via the ⚙ settings panel — never commit it to source.
const _rsCfg = null;

/** Events that only fire in trip scope. */
const TRIP_ONLY_EVENTS = [
  'trip_speed', 'trip_duration', 'trip_distance',
  'distracted_phone_use', 'distracted_phone_call_with_headset',
  'distracted_phone_call_without_headset'
];

/* =========================================================
   TEMPLATES — 16 pre-built rule templates from the catalog
   ========================================================= */

const TEMPLATES = [
  { id: "speed_warning", description: "Warn when speed exceeds 120 km/h during trip.", sessionScope: "trip", priority: 9, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 3 }, output: { tone: "calm and concerned", instructions: "Ask the driver to slow down, their speed is too high." }, triggerExpression: { type: "SINGLE", id: "trip_speed", dataSource: "SmartDrive", conditions: [{ type: "Value", parameter: "speed", operator: ">=", value: 120 }] } },
  { id: "trip_start_greeting", description: "Greet driver by name when trip starts, mention today's jobs count.", sessionScope: "trip", priority: 7, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 1 }, output: { tone: "friendly and warm", instructions: "Greet the driver by name and mention how many jobs they have today.", variables: [{ id: "firstname", dataSource: "MZONE" }, { id: "get_todays_jobs", dataSource: "MZONE" }] }, triggerExpression: { type: "SINGLE", id: "trip_started", dataSource: "SmartDrive" } },
  { id: "night_fatigue_coffee", description: "Suggest coffee break when driving 2+ hours between 22:00-02:00 with coffee shop nearby.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 1 }, output: { tone: "calm and warm", instructions: "Suggest the driver takes a coffee break. They have been driving a long time at night and there is a coffee shop nearby.", variables: [{ id: "coffee_shop", dataSource: "External Source" }] }, triggerExpression: { type: "GROUP", groupType: "AND", expressions: [{ type: "SINGLE", id: "trip_started", dataSource: "SmartDrive" }, { type: "SINGLE", id: "trip_duration", dataSource: "SmartDrive", conditions: [{ type: "Value", parameter: "duration", operator: ">=", value: 120 }] }, { type: "SINGLE", id: "hour_changed", dataSource: "DateTime", conditions: [{ type: "TimeRange", from: "22:00", to: "02:00" }] }] } },
  { id: "weekday_morning_greeting", description: "Greet driver at 9 AM on weekdays only.", sessionScope: "daily", priority: 7, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 1 }, output: { tone: "energetic and friendly", instructions: "Wish the driver a good morning and a productive day ahead." }, triggerExpression: { type: "SINGLE", id: "hour_changed", dataSource: "Phone", conditions: [{ type: "Value", parameter: "hour", operator: "==", value: 9 }, { type: "Value", parameter: "day_of_week", operator: "in", value: ["MON", "TUE", "WED", "THU", "FRI"] }] } },
  { id: "harsh_braking_alert", description: "Alert after 3+ harsh braking events in current trip.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 2 }, output: { tone: "calm and concerned", instructions: "Remind the driver to brake gently and maintain safe following distance." }, triggerExpression: { type: "SINGLE", id: "driving_behaviour_event_braking", dataSource: "SmartDrive", conditions: [{ type: "EventCount", eventName: "driving_behaviour_event_braking", operator: ">=", value: 3 }] } },
  { id: "high_stress_wellness", description: "Alert when driver stress is elevated from wellness measurement.", sessionScope: "daily", priority: 8, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 3 }, output: { tone: "calm and caring", instructions: "The driver's stress level is elevated. Suggest a calming activity or break." }, triggerExpression: { type: "SINGLE", id: "wellness_measurement_taken", dataSource: "Wellness", conditions: [{ type: "Value", parameter: "normalizedStressIndex", operator: ">", value: 5 }] } },
  { id: "depot_departure_summary", description: "Summarize route when entering depot before 10 AM with pending jobs and route not yet completed.", sessionScope: "daily", priority: 7, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 1 }, output: { tone: "professional and friendly", instructions: "Summarize the driver's route for today. They have arrived at the depot and their route is not yet completed.", variables: [{ id: "get_todays_jobs", dataSource: "MZONE" }] }, triggerExpression: { type: "GROUP", groupType: "AND", expressions: [{ type: "SINGLE", id: "poi_entry", dataSource: "POI", conditions: [{ type: "Value", parameter: "poi_type", operator: "==", value: "depot" }] }, { type: "SINGLE", id: "hour_changed", dataSource: "DateTime", conditions: [{ type: "Time", operator: "<=", value: "10:00" }] }, { type: "SINGLE", id: "get_todays_jobs", dataSource: "MZONE", conditions: [{ type: "Value", parameter: "RouteState", operator: "!=", value: "Completed" }] }] } },
  { id: "emergency_beacon", description: "Call dispatch and send API event when accident detected by beacon.", sessionScope: "global", priority: 10, throttle: { cooldownMinutes: 5, maxTriggersPerDay: 5 }, output: { tone: "calm and urgent", instructions: "Emergency detected. Ask if the driver is okay and inform them that dispatch is being contacted." }, actions: [{ type: "PhoneCall", number: { source: "static", value: "+31612345678" } }, { type: "APICall", id: "emergency_flow", dataSource: "MZONE" }], triggerExpression: { type: "SINGLE", id: "beacon_accident_detected", dataSource: "BLE" } },
  { id: "fuel_low_mhub", description: "Alert when fuel below 10% and consumption is high via BLE MHUB.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 3 }, output: { tone: "calm and informative", instructions: "The fuel level is critically low and consumption is high. Suggest refueling soon." }, triggerExpression: { type: "SINGLE", id: "fuel_level", dataSource: "BLE", conditions: [{ type: "Value", parameter: "level", operator: "<=", value: 10, source: "MHUB" }, { type: "Value", parameter: "consumption", operator: ">", value: 15 }] } },
  { id: "score_leaderboard_decline", description: "Motivate when monthly score and leaderboard position both dropped.", sessionScope: "global", priority: 7, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 1 }, output: { tone: "motivational and encouraging", instructions: "The driver's score and leaderboard position have declined this month. Encourage them to improve their driving." }, triggerExpression: { type: "GROUP", groupType: "AND", expressions: [{ type: "SINGLE", id: "montly_score_decreased", dataSource: "MZONE", conditions: [{ type: "Comparison", parameter: "score", firstPeriod: "currentMonth", secondPeriod: "lastMonth", operator: "<", value: "0" }] }, { type: "SINGLE", id: "leaderboard_position_declined", dataSource: "GZONE", conditions: [{ type: "Comparison", parameter: "position", firstPeriod: "currentMonth", secondPeriod: "lastMonth", operator: ">", value: "0" }] }] } },
  { id: "bad_weather_warning", description: "Inform about bad driving conditions from weather forecast during trip.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 60, maxTriggersPerDay: 3 }, output: { tone: "calm and informative", instructions: "Inform the driver about current weather conditions and suggest safe driving tips." }, triggerExpression: { type: "SINGLE", id: "weather_forecast", dataSource: "External Source", conditions: [{ type: "Value", parameter: "driving_conditions", operator: "==", value: "bad_driving_conditions" }] } },
  { id: "job_arrival_poi", description: "Provide job details when entering a job destination POI.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 15, maxTriggersPerDay: 20 }, output: { tone: "professional and friendly", instructions: "Tell the driver they have arrived at their job destination and provide the job details.", variables: [{ id: "job_details", dataSource: "MZONE" }] }, triggerExpression: { type: "SINGLE", id: "job_destination_entry", dataSource: "POI" } },
  { id: "upcoming_departure", description: "Remind driver about job departure within 1 hour.", sessionScope: "daily", priority: 7, throttle: { cooldownMinutes: 15, maxTriggersPerDay: 20 }, output: { tone: "helpful and friendly", instructions: "Remind the driver they have a job departure coming up soon.", variables: [{ id: "jobs", dataSource: "MZONE", triggerId: "get_todays_jobs", source: "jobs", fields: ["id", "description", "utcPlannedDeparture"] }] }, triggerExpression: { type: "SINGLE", id: "get_todays_jobs", dataSource: "MZONE", conditions: [{ type: "RelativeTimeWindow", parameter: "plannedDepartureDateTime", fromNow: "1h" }] } },
  { id: "weekly_performance", description: "Summarize weekly job activity after 11 AM on Tuesdays.", sessionScope: "daily", priority: 7, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 1 }, output: { tone: "professional and encouraging", instructions: "Provide a weekly summary of the driver's jobs. Mention how many jobs they had and their statuses.", variables: [{ id: "jobs", dataSource: "MZONE", triggerId: "get_all_jobs", source: "jobs", fields: ["id", "description", "jobStatus_Id"] }] }, triggerExpression: { type: "GROUP", groupType: "AND", expressions: [{ type: "SINGLE", id: "get_all_jobs", dataSource: "MZONE", conditions: [{ type: "Value", parameter: "count", operator: ">=", value: 1 }] }, { type: "SINGLE", id: "hour_changed", dataSource: "Phone", conditions: [{ type: "Value", parameter: "hour", operator: ">=", value: 11 }, { type: "Value", parameter: "day_of_week", operator: "in", value: ["TUE"] }] }] } },
  { id: "urgent_jobs_filtered", description: "List pending high-priority jobs using filtered extraction.", sessionScope: "daily", priority: 8, throttle: { cooldownMinutes: 90, maxTriggersPerDay: 3 }, output: { tone: "professional and urgent", instructions: "List pending high-priority jobs requiring immediate attention.", variables: [{ id: "urgentJobs", dataSource: "MZONE", triggerId: "get_todays_jobs", source: "jobs", fields: ["id", "description", "priority"], filters: [{ type: "Value", parameter: "jobStatus_Id", operator: "==", value: 1 }, { type: "Value", parameter: "priority", operator: ">=", value: 2 }] }] }, triggerExpression: { type: "SINGLE", id: "get_todays_jobs", dataSource: "MZONE", conditions: [{ type: "Value", parameter: "count", operator: ">=", value: 1 }] } },
  { id: "speed_or_long_duration", description: "Warn on speeding OR driving 3+ hours, only at night.", sessionScope: "trip", priority: 8, throttle: { cooldownMinutes: 30, maxTriggersPerDay: 1 }, output: { tone: "calm and concerned", instructions: "The driver is either speeding or has been driving too long at night. Suggest they slow down or take a break." }, triggerExpression: { type: "GROUP", groupType: "AND", expressions: [{ type: "SINGLE", id: "trip_started", dataSource: "SmartDrive" }, { type: "SINGLE", id: "hour_changed", dataSource: "DateTime", conditions: [{ type: "TimeRange", from: "22:00", to: "05:00" }] }, { type: "GROUP", groupType: "OR", expressions: [{ type: "SINGLE", id: "trip_speed", dataSource: "SmartDrive", conditions: [{ type: "Value", parameter: "speed", operator: ">=", value: 120 }] }, { type: "SINGLE", id: "trip_duration", dataSource: "SmartDrive", conditions: [{ type: "Value", parameter: "duration", operator: ">=", value: 180 }] }] }] } }
];
