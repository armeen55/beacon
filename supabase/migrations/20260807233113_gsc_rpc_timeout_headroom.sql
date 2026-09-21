-- The two GSC read functions aggregate 145K rows; the covering index makes a warm run ~100ms but cold or
-- concurrent runs can exceed the API role's default statement timeout and fail the whole surface read.
-- Give exactly these two functions their own 20s ceiling. Function-scoped, additive, drops nothing.
alter function gsc_page_signals_v1(text, date) set statement_timeout = '20s';
alter function gsc_decay_v1(text, date, date) set statement_timeout = '20s';;
