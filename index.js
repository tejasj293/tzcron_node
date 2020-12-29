/* 
A library to work with cron/quartz expressions and timezones.
The library provides a way to define schedules attached to timezones and get
time occurrences out of it by just iterating the object created.
See the Schedule class for further details
The key terms used in the documentations are:
- Schedule: Specification of a successions of occurrences
- Occurrence: point in time that is satisfied by the specification of a schedule
As an example, a schedule is every tuesday at 2pm in London,
an occurrence is next tuesday at 2pm with an offset from utc of +60 minutes.
*/

var datetime = require('node-datetime');
var tzinfo = require('tzinfo');

class InvalidExpression extends Exception {

    /* Custom Method */

}

class Schedule {

    constructor (expression, tzone, start_date, end_date, filters) {
        
        start_date = start_date || datetime.create(new Date().getDate())

        this.start_date = start_date
        this.end_date = end_date
        this.tzone = tzone
        this.expression = expression

        if (tzinfo.findTzinfo(start_date) == null || (end_date && tzinfo.findTzinfo(start_date) == null)) {

            throw "Start and End dates should have a timezone"

        }

        start_t = tzinfo.findTzinfo(start_date)
        end_t = end_date ? tzinfo.findTzinfo(end_date) : null

        start_t = start_t.replace(tzinfo=null)
        if (end_t) {
            end_t = end_t.replace(tzinfo=null)    
        } else {
            end_t = null
        }

        this._rrule = process(expression, start_t, end_t)
        this.__rrule_iterator = iter(self._rrule)
        if (filters) {
            this.filters = filters
        } else {
            this.filters = []
        }
        
        self.filters.append(get_year_filter(self.expression.split(" ")[-1]))

    }

}

class Parser extends Object {

    /*
    Abstract class to create parsers for parts of quartz expressions
    Each parser can be used per token and a specific parser needs to provide
     the valid ranges of the quartz part and a dict of REPLACEMENTS in upper case
    See the specific parsers below (Ex: MinuteParser, WeekDayParser, etc..)
    All values:
        A star can be used to specify all valid values
    Multiple options:
        Each of the expression parsed can contain a list of expressions as
         a comma separated list. duplicates are removed
        Example: 0,1,4 Means 0, 1 and 4
    Ranges:
        A dash can be used to represent ranges
        2-5 Means 2 to 3
    Step:
        A slash can be used to specify a step
        Example: 2 Means to pick one of every two values.
                 if the valid range is 0 to 3 it will return 0 and 2
    Replacements:
        Each specific parser can define String replacements for the expression.
        Ex: JAN is ok for 1 (Jan) [ Case insensitive ]
    Other examples:
        "1,3-6,8" -> [1, 3, 4, 5, 6, 8].
        '1-3, 0-10/2" -> [0, 1, 2, 3, 4, 6, 8, 10]
    */

    constructor () {

        this.MIN_VALUE = null
        this.MAX_VALUE = null
        this.REPLACEMENTS = {}

        this.QUARTZ_REGEXP = new RegExp("(?P<start>(\d+)|\*)(-(?P<end>\d+))?(/(?P<step>\d+))?")

    }

    _parse_item (expression) {

        var expression = String.prototype.toUpperCase(expression)
        for (var key in this.REPLACEMENTS) {
            if (this.REPLACEMENTS.hasOwnProperty(key)) {           
                expression = expression.replace(key, this.REPLACEMENTS[key])
            }
        }
        var matches = expression.match(this.QUARTZ_REGEXP)
        if (!matches) {
            // InvalidExpression Error
        }

        var start = matches.group("start")
        var end = matches.group("end") 
        var step = matches.group("step")

        if (start == "*") {
            start = this.MIN_VALUE
            end = this.MAX_VALUE
        }
        
    }

    parse (expression) {
        /* Parses the quartz expression
        :param expression: expression string encoded to parse
        returns: sorted list of unique elements resulting from the expression
        */

        var groups = []
        for (var item in expression.split(",")) {
            groups.push(this._parse_item(item))
        }
    }

}

class MinuteParser extends Parser {

    MIN_VALUE = 0
    MAX_VALUE = 59

}

class HourParser extends Parser {
    /* Custom parser for hours */
    MIN_VALUE = 0
    MAX_VALUE = 23

}

class MonthDayParser extends Parser {
    /* Custom parser for month days */
    MIN_VALUE = 1
    MAX_VALUE = 31

}

class MonthParser extends Parser {
    /* Custom parser for months */
    MIN_VALUE = 1
    MAX_VALUE = 12
    REPLACEMENTS = {
        "JAN": "1",
        "FEB": "2",
        "MAR": "3",
        "APR": "4",
        "MAY": "5",
        "JUN": "6",
        "JUL": "7",
        "AUG": "8",
        "SEP": "9",
        "OCT": "10",
        "NOV": "11",
        "DEC": "12"
    }

}

class WeekDayParser extends Parser {
    /* Custom parser for week days */
    MIN_VALUE = 1
    MAX_VALUE = 7
    REPLACEMENTS = {
        "MON": "1",
        "TUE": "2",
        "WED": "3",
        "THU": "4",
        "FRI": "5",
        "SAT": "6",
        "SUN": "7"
    }
}

function parse_cron (expression) {

    try {
        minute, hour, monthday, month, weekday, _ = expression.split(' ')
    } catch (Exception) {
        throw InvalidExpression
    }

    var result = {}
    result["bytesecond"] = [0]

    if (minute != "*") {
        result["byminute"] = MinuteParser.parse(minute)
    }
    if (hour != "*") {
        result["byhour"] = MinuteParser.parse(hour)
    }
    if (monthday != "*") {
        result["bymonthday"] = MinuteParser.parse(monthday)
    } 
    if (month != "*") {
        result["bymonth"] = MinuteParser.parse(month)
    } 
    if (weekday != "*") {
        result["bymonthday"] = MinuteParser.parse(weekday)
    } 

    return result
}

function process (expression, start_date, end_date=null) {

    /* Given a cron expression and a start/end date returns an rrule
    Works with "naive" datetime objects.
    */
    if (tzinfo.findTzinfo(start_date) || (end_date && tzinfo.findTzinfo(end_date))) {
        throw "Timezones are forbidden in this land."
    }

    var arguments = parse_cron(expression)

    // as rrule will strip out microseconds, we need to do this hack :)
    // we could use .after but that changes the iface
    // The idea is, as the cron expresion works at minute level, it is fine to
    // set the start time one second after the minute. The key is not to generate
    // the current minute.
    // Ex: if start time is 05:00.500 you should not generate 05:00

    if (start_date.second == 0 && start_date.microsecond != 0) {
        // start_date = start_date + dt.timedelta(0, 1)
    }

    arguments["dtstart"] = start_date

    if (end_date) {
        arguments["until"] = end_date
    }

    // return rrule.rrule(rrule.MINUTELY, **arguments)

}

function get_year_filter (year) {

    // Creates a filter for a year

    function year_filter (occurrence) {

        /* Filter for years
        Using the year captured the closure, returns false if the occurrence
        is before the year, true when is in the year and stops when is past
        */

        if (year == "*") {
            return true
        } else {
            var valid_year = year
            if (occurrence.year < valid_year) {
                return false
            } else if (occurrence.year > valid_year) {
                throw "Valid time already past"
            } else {
                return true
            }
        }

    }

    return year_filter

}
