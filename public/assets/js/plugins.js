(document.querySelectorAll("[toast-list]") ||
  document.querySelectorAll("[data-choices]") ||
  document.querySelectorAll("[data-provider]")) &&
  (document.writeln(
    "<script type='text/javascript' src='https://cdn.jsdelivr.net/npm/toastify-js' ></script>"
  ),
  document.writeln(
    "<script type='text/javascript' src='../libs/choices/choices/choices.min.js'></script>"
  ),
  document.writeln(
    "<script type='text/javascript' src='/libs/flatpicker/flatpickr.min.js'></script>"
  ));
