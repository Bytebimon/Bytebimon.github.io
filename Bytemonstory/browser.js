const form = document.getElementById('actionForm');
const webView = document.getElementById('webView');

const siteRoutes = {
  '101100110001110100110011': 'Sites/Hack.html',
  'binary.load': 'Sites/Binary.html',
  'adventure.net': 'Sites/online.html',
  news: 'Sites/News.html',
  'calculator.com': 'Sites/Calculator.html',
  'bytebimon.com': 'Sites/Bytebimon.html'
};

if (form && webView) {
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    const command = document.getElementById('userInput').value.trim().toLowerCase();
    const forceHack = Math.random() < 1 / 3;

    if (forceHack) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'launch-hack-overlay' }, '*');
      } else {
        window.location.href = 'Sites/Hack.html';
      }
    } else if (siteRoutes[command]) {
      webView.src = siteRoutes[command];
    } else {
      console.warn(`Command not recognized: ${command}`);
      alert(`Error: The address "${command}" could not be resolved on the network.`);
    }

    document.getElementById('userInput').value = '';
  });
}
