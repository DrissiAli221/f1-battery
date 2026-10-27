// Map the five entry paths to their prerendered pages; everything else (assets, files) passes through.
function handler(event) {
  var request = event.request;
  var pages = {
    '/': '/index.html',
    '/session': '/session.html',
    '/findings': '/findings.html',
    '/method': '/method.html',
    '/replay': '/replay.html'
  };
  var uri = request.uri;
  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') {
    uri = uri.slice(0, -1);
  }
  if (Object.prototype.hasOwnProperty.call(pages, uri)) {
    request.uri = pages[uri];
  }
  return request;
}
