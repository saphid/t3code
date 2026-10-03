// Navigates its own frame to a data: document whose script reports to the fixture server.
(async () => {
  const target = "data:text/html,%3Cscript%3Enew Image().src=%22http://127.0.0.1:7391/marker?ran=1%26case=nav-data%22%3C/script%3E";
  const { port } = await window.t3View.port;
  setTimeout(() => location.assign(target), 100);
  setTimeout(() => port.postMessage({ type: "still-alive", target: "data: page" }), 1500);
})();
